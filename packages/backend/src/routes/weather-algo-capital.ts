import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { SimulationService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { resolveTradingWalletContext } from '../polymarket/trading-wallet-resolver.js';
import { fetchPusdBalance } from '../polymarket/pusd-balance.js';
import pino from 'pino';

const log = pino({ name: 'weather-algo-capital' });

export interface WeatherAlgoCapitalResponse {
  sim: {
    equity: number;
    cash: number;
    positionsValue: number;
    openPnl: number;
    closedPnl: number;
    baselineCapital: number;
  } | null;
  real: {
    availableCash: number | null;
    note: string | null;
  };
}

export function createWeatherAlgoCapitalRouter(ds: DataSource): Router {
  const router = Router();
  const simulationService = new SimulationService(ds);

  router.get('/', requireJwt, async (_req, res) => {
    // Sim capital — now per-algoKind, no watchlist resolution needed
    const snapshot = await simulationService.getSnapshot('weather');
    const sim: WeatherAlgoCapitalResponse['sim'] = {
      equity: snapshot.equity,
      cash: snapshot.amount,
      positionsValue: snapshot.positionsValue,
      openPnl: snapshot.openPnlSum,
      closedPnl: snapshot.closedPnlSum,
      baselineCapital: snapshot.baselineCapital,
    };

    // Real capital — global on-chain pUSD (shared wallet, not partitioned)
    let realCash: number | null = null;
    let realNote: string | null = null;
    try {
      const ctx = await resolveTradingWalletContext(ds);
      if (ctx?.depositAddress) {
        realCash = await fetchPusdBalance(ctx.depositAddress);
        realNote = 'on_chain_pusd_balance';
      } else {
        realNote = ctx ? 'no_deposit_address' : 'no_credentials';
      }
    } catch (err) {
      log.warn({ err }, 'failed to fetch real capital for weather-algo page');
      realNote = 'fetch_failed';
    }

    const result: WeatherAlgoCapitalResponse = {
      sim,
      real: { availableCash: realCash, note: realNote },
    };
    res.json(result);
  });

  return router;
}
