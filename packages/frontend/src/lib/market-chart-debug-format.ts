import type { LiquidityStatus } from './market-chart';

export const DEBUG_EMPTY = 'N/A';

export function isDebugEmpty(value: string): boolean {
  return value === DEBUG_EMPTY;
}

export function fmtDebugPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DEBUG_EMPTY;
  return `${value.toFixed(2)}%`;
}

export function fmtDebugMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DEBUG_EMPTY;
  return `${Math.round(value)} ms`;
}

export function fmtDebugUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DEBUG_EMPTY;
  return `$${value.toFixed(2)}`;
}

export function fmtDebugBool(value: boolean | null | undefined): string {
  if (value == null) return DEBUG_EMPTY;
  return value ? 'Oui' : 'Non';
}

export function fmtDebugGap(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DEBUG_EMPTY;
  return value.toFixed(4);
}

export function fmtDebugSeconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DEBUG_EMPTY;
  return `${value}s`;
}

const LIQUIDITY_LABELS: Record<LiquidityStatus, string> = {
  ok: 'Liquide',
  partial: 'Partielle',
  illiquid: 'Illiquide',
};

export function fmtLiquidityStatus(
  value: LiquidityStatus | null | undefined,
): string {
  if (!value) return DEBUG_EMPTY;
  return LIQUIDITY_LABELS[value];
}

export function liquidityStatusClass(
  value: LiquidityStatus | null | undefined,
): string {
  if (value === 'illiquid') return 'liquidity-illiquid';
  if (value === 'partial') return 'liquidity-partial';
  if (value === 'ok') return 'liquidity-ok';
  return 'liquidity-unknown';
}

export function resolveMarketLiquidityStatus(
  up: LiquidityStatus | null | undefined,
  down: LiquidityStatus | null | undefined,
): LiquidityStatus | null {
  const rank: Record<LiquidityStatus, number> = {
    illiquid: 3,
    partial: 2,
    ok: 1,
  };
  let worst: LiquidityStatus | null = null;
  for (const status of [up, down]) {
    if (!status) continue;
    if (!worst || rank[status] > rank[worst]) worst = status;
  }
  return worst;
}

const SPREAD_WARN_PCT = 10;

export function debugSpreadValueClass(
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return '';
  return value > SPREAD_WARN_PCT ? 'market-chart-debug-warn' : '';
}

export function debugWsValueClass(
  value: boolean | null | undefined,
): string {
  if (value == null) return '';
  return value ? 'market-chart-debug-ok' : 'market-chart-debug-danger';
}
