import {
  binaryPricesFromParsed,
  binaryPricesToUpDown,
} from '../polymarket/outcome-tokens.js';
import type { GammaMarket } from '../polymarket/market-metadata.js';
import type { Market } from '../entities/Market.js';
import {
  isMarketRedeemable,
  marketLifecycleFromEntity,
} from '../market/lifecycle.js';
import { resolveWinningOutcome } from '../polymarket/redemption.js';
import {
  isRedemptionOutcomePrices,
  REDEMPTION_WIN_THRESHOLD,
  type OutcomePrices,
} from './algo-surveillance.types.js';

export type UpDownWinner = 'Up' | 'Down';

/** Maximum drift we tolerate between Gamma's endDate and start + interval. */
const END_DATE_DRIFT_MS = 60_000;

export function parseIntervalToMs(interval: string | null | undefined): number | null {
  if (!interval) return null;
  const match = interval.match(/^(\d+)\s*(m|min|h|d|w)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2]!.toLowerCase();
  switch (unit) {
    case 'm':
    case 'min':
      return value * 60_000;
    case 'h':
      return value * 60 * 60_000;
    case 'd':
      return value * 24 * 60 * 60_000;
    case 'w':
      return value * 7 * 24 * 60 * 60_000;
    default:
      return null;
  }
}

export function resolveSurveillanceEndAt(
  marketStartAt: string | null,
  gammaEndDate: string | null | undefined,
  interval: string | null | undefined,
): Date | null {
  const startMs = marketStartAt ? Date.parse(marketStartAt) : NaN;
  const intervalMs = parseIntervalToMs(interval);
  const computedEndMs =
    Number.isFinite(startMs) && intervalMs != null ? startMs + intervalMs : NaN;

  const gammaEndMs = gammaEndDate ? Date.parse(gammaEndDate) : NaN;

  if (Number.isFinite(computedEndMs) && Number.isFinite(gammaEndMs)) {
    if (Math.abs(computedEndMs - gammaEndMs) <= END_DATE_DRIFT_MS) {
      return new Date(gammaEndMs);
    }
    if (gammaEndMs < startMs) {
      return new Date(computedEndMs);
    }
    return new Date(gammaEndMs);
  }

  if (Number.isFinite(computedEndMs)) return new Date(computedEndMs);
  if (Number.isFinite(gammaEndMs)) return new Date(gammaEndMs);
  return null;
}

export function parseUpDownPricesFromGamma(gamma: GammaMarket | null): OutcomePrices {
  const resolved = binaryPricesFromParsed(gamma?.outcomePricesParsed ?? []);
  const { upPrice, downPrice } = binaryPricesToUpDown(resolved);
  return { upPrice, downPrice };
}

export function resolveUpDownWinnerFromMarket(market: Market | null): UpDownWinner | null {
  if (!market) return null;
  if (!isMarketRedeemable(marketLifecycleFromEntity(market))) return null;

  if (market.winningTokenId && market.tokenIdYes && market.tokenIdNo) {
    const mapped = resolveWinningOutcome(
      market.winningTokenId,
      market.tokenIdYes,
      market.tokenIdNo,
    );
    if (mapped === 'YES') return 'Up';
    if (mapped === 'NO') return 'Down';
  }

  return null;
}

export function resolveUpDownWinnerLabel(
  gamma: GammaMarket | null,
  market?: Market | null,
): UpDownWinner | null {
  if (gamma) {
    const winnerFromPrices = gamma.outcomePricesParsed.find(
      (p) => p.price >= REDEMPTION_WIN_THRESHOLD,
    );
    if (winnerFromPrices) {
      const label = winnerFromPrices.outcome.toLowerCase();
      if (label === 'up' || label === 'yes') return 'Up';
      if (label === 'down' || label === 'no') return 'Down';
    }

    if (gamma.winningTokenId && gamma.tokenIdYes && gamma.tokenIdNo) {
      const mapped = resolveWinningOutcome(
        gamma.winningTokenId,
        gamma.tokenIdYes,
        gamma.tokenIdNo,
      );
      if (mapped === 'YES') return 'Up';
      if (mapped === 'NO') return 'Down';
    }
  }

  if (market) return resolveUpDownWinnerFromMarket(market);

  return null;
}

export function redemptionPricesForWinner(winner: UpDownWinner): OutcomePrices {
  return {
    upPrice: winner === 'Up' ? 1 : 0,
    downPrice: winner === 'Down' ? 1 : 0,
  };
}

export function tryRedemptionPricesFromGamma(gamma: GammaMarket): OutcomePrices | null {
  const winner = resolveUpDownWinnerLabel(gamma);
  return winner ? redemptionPricesForWinner(winner) : null;
}

export function snapshotHasRedemptionClose(snapshot: {
  closeUpPrice: number | null;
  closeDownPrice: number | null;
  closeCapturedAt: string | null;
}): boolean {
  if (!snapshot.closeCapturedAt) return false;
  return isRedemptionOutcomePrices({
    upPrice: snapshot.closeUpPrice,
    downPrice: snapshot.closeDownPrice,
  });
}
