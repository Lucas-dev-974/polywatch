import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import {
  AlgoAutoTrackService,
  AlgoMarketSelectionService,
  createAlgoSelectionServices,
} from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { publishConfigChanged } from '../redis.js';
import { emitAlgoMarketsChanged } from '../websocket.js';

const createRuleSchema = z.object({
  cryptoSymbol: z.string().min(1),
  interval: z.string().min(1),
});

const patchRuleSchema = z.object({
  enabled: z.boolean(),
});

async function syncAutoTrackMarkets(
  autoTrackService: AlgoAutoTrackService,
  selectionService: AlgoMarketSelectionService,
  options?: { force?: boolean },
): Promise<{ disabled: number; added: number }> {
  const sync = await autoTrackService.syncMarketSelectionsIfNeeded(
    selectionService,
    options,
  );
  if (sync.ran && (sync.disabled > 0 || sync.added > 0)) {
    await publishConfigChanged();
    emitAlgoMarketsChanged();
  }
  return { disabled: sync.disabled, added: sync.added };
}

export function createAlgoAutoTrackRouter(ds: DataSource): Router {
  const router = Router();
  const autoTrackService = new AlgoAutoTrackService(ds);
  const { selectionService } = createAlgoSelectionServices(ds);

  router.get('/', requireJwt, async (_req, res) => {
    res.json(await autoTrackService.loadAll());
  });

  router.post('/', requireJwt, async (req, res) => {
    const parsed = createRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const { cryptoSymbol, interval } = parsed.data;
    try {
      const rule = await autoTrackService.createRule(cryptoSymbol, interval);
      const { added } = await syncAutoTrackMarkets(
        autoTrackService,
        selectionService,
        { force: true },
      );
      if (added === 0) {
        const hasActive = await autoTrackService.hasActiveSelectionForRule(
          cryptoSymbol,
          interval,
        );
        if (!hasActive) {
          console.warn(
            `[algo-auto-track] no active market found for ${cryptoSymbol} / ${interval}`,
          );
        }
      }
      res.status(201).json(rule);
    } catch (err: any) {
      if (err?.message === 'DUPLICATE_RULE') {
        res.status(409).json({
          error: 'duplicate_rule',
          message: `A rule for ${cryptoSymbol} / ${interval} already exists`,
        });
        return;
      }
      throw err;
    }
  });

  router.delete('/:id', requireJwt, async (req, res) => {
    const id = Number(req.params.id);
    await autoTrackService.deleteRule(id);
    await publishConfigChanged();
    res.status(204).end();
  });

  router.patch('/:id', requireJwt, async (req, res) => {
    const parsed = patchRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_body',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      return;
    }
    const id = Number(req.params.id);
    const rule = await autoTrackService.loadAll().then((rules) => rules.find((r) => r.id === id));
    await autoTrackService.setEnabled(id, parsed.data.enabled);
    await publishConfigChanged();

    if (parsed.data.enabled && rule) {
      await syncAutoTrackMarkets(autoTrackService, selectionService, { force: true });
    }

    res.status(200).json({ ok: true });
  });

  return router;
}
