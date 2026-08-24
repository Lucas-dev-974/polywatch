// ─── Crypto algo data API (onglet Données) ────────────────────────────────

import type { CryptoAlgoDataTableId } from '../lib/ui-persistence';
import { api, buildQueryString } from './http';

export interface CryptoAlgoDataTableSummary {
  id: CryptoAlgoDataTableId;
  tableName: string;
  rowCount: number;
  oldestAt: string | null;
  newestAt: string | null;
  readOnly: boolean;
}

export interface CryptoAlgoDataTablesResponse {
  tables: CryptoAlgoDataTableSummary[];
}

export interface CryptoAlgoDataListResponse<T> {
  items: T[];
  total: number;
}

export interface CryptoAlgoDataDeleteAllResponse {
  deleted: Record<CryptoAlgoDataTableId, number>;
  totalDeleted: number;
}

export interface CryptoAlgoDataDeleteTableResponse {
  id: CryptoAlgoDataTableId;
  deleted: number;
}

export interface CryptoAlgoDataCoverage {
  from: string | null;
  to: string | null;
  symbols: string[];
  totalPriceTicks: number;
  totalSurveillanceSnapshots: number;
  totalPostEntryMidSamples: number;
  totalMarketSelections: number;
  totalAutoTrackRules: number;
}

export interface CryptoAlgoPriceTickRow {
  id: number;
  conditionId: string;
  upPrice: number | null;
  downPrice: number | null;
  upBid: number | null;
  upAsk: number | null;
  downBid: number | null;
  downAsk: number | null;
  upSpreadPct: number | null;
  downSpreadPct: number | null;
  upAskVwap: number | null;
  downAskVwap: number | null;
  upLiquidityStatus: string | null;
  downLiquidityStatus: string | null;
  priceGap: number | null;
  secondsUntilEnd: number | null;
  bookStalenessMs: number | null;
  wsHealthy: boolean | null;
  openPositionsCount: number;
  openExposureUsd: number | null;
  unrealizedPnl: number | null;
  lastSignalOutcome: string | null;
  lastSignalConfidence: number | null;
  lastSignalStrategyId: string | null;
  signalAgeMs: number | null;
  lastAbstainReason: string | null;
  recordedAt: string;
  createdAt: string;
}

export interface CryptoAlgoSurveillanceSnapshotRow {
  id: number;
  conditionId: string;
  question: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  slug: string | null;
  marketStartAt: string | null;
  marketEndAt: string | null;
  openUpPrice: number | null;
  openDownPrice: number | null;
  openCapturedAt: string | null;
  closeUpPrice: number | null;
  closeDownPrice: number | null;
  closeCapturedAt: string | null;
  winningOutcome: string | null;
  unresolvedAt: string | null;
}

export interface CryptoAlgoPostEntryMidSampleRow {
  id: number;
  conditionId: string;
  outcome: string;
  positionId: number | null;
  filledAtMs: string;
  offsetMs: number;
  upMid: number | null;
  downMid: number | null;
  sampledAtMs: string;
  createdAt: string;
}

export interface CryptoAlgoMarketSelectionRow {
  id: number;
  conditionId: string;
  question: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  slug: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CryptoAlgoAutoTrackRuleRow {
  id: number;
  cryptoSymbol: string;
  interval: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CryptoAlgoExecutionRow {
  id: number;
  orderSignalId: string;
  copiedPositionId: number;
  mode: string;
  side: string;
  orderType: string | null;
  requestedQty: number | null;
  fillPrice: number | null;
  fillQuantity: number | null;
  referenceVwap: number | null;
  slippagePercent: number | null;
  fees: number;
  realizedPnl: number;
  status: string;
  reason: string | null;
  txHash: string | null;
  clobOrderId: string | null;
  error: string | null;
  executedAt: string | null;
}

export interface CryptoAlgoPositionRow {
  id: number;
  conditionId: string;
  assetId: string;
  outcome: string;
  side: string;
  quantity: number;
  entryPrice: number;
  entryBidVwap: number;
  unrealizedPnl: number;
  realizedPnl: number;
  status: string;
  mode: string;
  openedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  reason: string | null;
  slBidPoints: number | null;
  tpBidPoints: number | null;
}

export async function fetchCryptoAlgoDataTables(): Promise<CryptoAlgoDataTablesResponse> {
  return api<CryptoAlgoDataTablesResponse>('/crypto-algo-data/tables');
}

export async function fetchCryptoAlgoDataCoverage(): Promise<CryptoAlgoDataCoverage> {
  return api<CryptoAlgoDataCoverage>('/crypto-algo-data/coverage');
}

export async function fetchCryptoAlgoPriceTicks(params: {
  conditionId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<CryptoAlgoDataListResponse<CryptoAlgoPriceTickRow>> {
  return api(`/crypto-algo-data/price-ticks${buildQueryString(params)}`);
}

export async function fetchCryptoAlgoSurveillanceSnapshots(params: {
  limit?: number;
  offset?: number;
}): Promise<CryptoAlgoDataListResponse<CryptoAlgoSurveillanceSnapshotRow>> {
  return api(`/crypto-algo-data/surveillance-snapshots${buildQueryString(params)}`);
}

export async function fetchCryptoAlgoPostEntryMidSamples(params: {
  conditionId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<CryptoAlgoDataListResponse<CryptoAlgoPostEntryMidSampleRow>> {
  return api(`/crypto-algo-data/post-entry-mid-samples${buildQueryString(params)}`);
}

export async function fetchCryptoAlgoMarketSelections(params: {
  enabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<CryptoAlgoDataListResponse<CryptoAlgoMarketSelectionRow>> {
  return api(`/crypto-algo-data/market-selections${buildQueryString(params)}`);
}

export async function fetchCryptoAlgoAutoTrackRules(params: {
  enabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<CryptoAlgoDataListResponse<CryptoAlgoAutoTrackRuleRow>> {
  return api(`/crypto-algo-data/auto-track-rules${buildQueryString(params)}`);
}

export async function fetchCryptoAlgoExecutions(params: {
  conditionId?: string;
  mode?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<CryptoAlgoDataListResponse<CryptoAlgoExecutionRow>> {
  return api(`/crypto-algo-data/executions${buildQueryString(params)}`);
}

export async function fetchCryptoAlgoPositions(params: {
  conditionId?: string;
  mode?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<CryptoAlgoDataListResponse<CryptoAlgoPositionRow>> {
  return api(`/crypto-algo-data/positions${buildQueryString(params)}`);
}

export async function deleteCryptoAlgoDataTables(): Promise<CryptoAlgoDataDeleteAllResponse> {
  return api<CryptoAlgoDataDeleteAllResponse>('/crypto-algo-data/tables', {
    method: 'DELETE',
  });
}

export async function deleteCryptoAlgoDataTable(
  id: CryptoAlgoDataTableId,
): Promise<CryptoAlgoDataDeleteTableResponse> {
  return api<CryptoAlgoDataDeleteTableResponse>(`/crypto-algo-data/tables/${id}`, {
    method: 'DELETE',
  });
}
