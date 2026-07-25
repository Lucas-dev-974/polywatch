import type { DataSource } from 'typeorm';
import {
  AlgoMarketSelection,
  Market,
  type AlgoSignal,
} from '@polywatch/core';

export interface MarketFixture {
  conditionId: string;
  tokenIdYes: string;
  tokenIdNo: string;
}

export async function seedAlgoMarketFixture(ds: DataSource): Promise<MarketFixture> {
  const conditionId = '0xbtc5m_exec_harden_e2e_fixture01';
  const tokenIdYes = '0xYES_exec_harden_e2e_fixture01';
  const tokenIdNo = '0xNO_exec_harden_e2e_fixture01';
  const futureDate = new Date(Date.now() + 60 * 60 * 1000);

  const marketRepo = ds.getRepository(Market);
  await marketRepo.save(
    marketRepo.create({
      conditionId,
      question: 'Will BTC be up in 5m? (execution hardening e2e)',
      slug: 'btc-updown-5m-harden-e2e',
      eventSlug: 'btc-updown',
      endDate: futureDate,
      acceptingOrders: true,
      closed: false,
      resolved: false,
      tokenIdYes,
      tokenIdNo,
      active: true,
      icon: null,
      category: 'Crypto',
      tagSlugs: JSON.stringify(['crypto']),
    }),
  );

  const selectionRepo = ds.getRepository(AlgoMarketSelection);
  await selectionRepo.save(
    selectionRepo.create({
      conditionId,
      question: 'Will BTC be up in 5m? (execution hardening e2e)',
      cryptoSymbol: 'BTC',
      interval: '5m',
      slug: 'btc-updown-5m-harden-e2e',
      enabled: true,
    }),
  );

  return { conditionId, tokenIdYes, tokenIdNo };
}

export function makeAlgoBuySignal(
  fixture: MarketFixture,
  overrides?: Partial<AlgoSignal>,
): AlgoSignal {
  return {
    conditionId: fixture.conditionId,
    assetId: fixture.tokenIdYes,
    outcome: 'YES',
    side: 'BUY',
    confidence: 0.8,
    reasons: ['execution hardening e2e'],
    strategyId: 'naive-momentum',
    interval: '5m',
    ...overrides,
  };
}
