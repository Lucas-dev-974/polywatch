import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { SimulationService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { resolveTradingWalletContext } from '../polymarket/trading-wallet-resolver.js';
import { fetchPusdBalance } from '../polymarket/pusd-balance.js';
import pino from 'pino';

const log = pino({ name: 'algo-capital' });

export interface AlgoCapitalResponse {
  sim: {
    equity: number;
    cash: number;
    positionsValue: number;
    openPnl: number;
    closedPnl: number;
    baselineCapital: number;
  };
  real: {
    availableCash: number | null;
    note: string | null;
  };
}

export function createAlgoCapitalRouter(ds: DataSource): Router {
  const router = Router();
  const simulationService = new SimulationService(ds);

  router.get('/', requireJwt, async (_req, res) => {
    // Sim capital
    const snapshot = await simulationService.getSnapshot();

    // Real capital
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
      log.warn({ err }, 'failed to fetch real capital for algo page');
      realNote = 'fetch_failed';
    }

    const result: AlgoCapitalResponse = {
      sim: {
        equity: snapshot.equity,
        cash: snapshot.amount,
        positionsValue: snapshot.positionsValue,
        openPnl: snapshot.openPnlSum,
        closedPnl: snapshot.closedPnlSum,
        baselineCapital: snapshot.baselineCapital,
      },
      real: {
        availableCash: realCash,
        note: realNote,
      },
    };

    res.json(result);
  });

  return router;
}
