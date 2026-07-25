import {
  closurePnlPercent,
  evaluateCopyIncreaseSlProximity,
  getModeAllowedMarketTags,
  getModeCopyIncreaseSlProximityEnabled,
  getModeCopyIncreaseSlProximityPercent,
  isCopyMoveAllowed,
  isIncreaseAllowed,
  isMarketTagAllowedForMode,
  MarketService,
  RiskConfig,
  RiskService,
  WatchlistService,
  type MoveEventDto,
  type TradingMode,
} from '@polywatch/core';
import pino from 'pino';
import { hasBlockingActivePosition, findOpenPosition } from './copy-position-lookup.js';
import { postBackendAlert } from '../../backend-client.js';
import type { DataSource } from 'typeorm';

const log = pino({ name: 'copy-risk-gate' });

export type WatchlistEntry = NonNullable<
  Awaited<ReturnType<WatchlistService['findByTraderAddress']>>
>;

export function resolveCopyModesWithReasons(
  entry: WatchlistEntry,
  risk: RiskConfig,
): { modes: TradingMode[]; skippedRealReason?: string } {
  const modes: TradingMode[] = [];
  let skippedRealReason: string | undefined;
  if (entry.simEnabled) modes.push('sim');
  if (entry.realEnabled) {
    if (RiskService.isRealTradingEnabledForConfig(risk)) {
      modes.push('real');
    } else {
      skippedRealReason = 'Trading réel désactivé (config)';
    }
  }
  return { modes, skippedRealReason };
}

export async function passesMarketTagFilter(
  marketService: MarketService,
  conditionId: string,
  risk: RiskConfig,
  mode: TradingMode,
): Promise<boolean> {
  if (getModeAllowedMarketTags(risk, mode).length === 0) return true;

  const tagSlugs = await marketService.resolveTagSlugs(conditionId);
  if (isMarketTagAllowedForMode(tagSlugs, risk, mode)) return true;

  log.info(
    {
      mode,
      conditionId,
      tagSlugs,
      allowedTags: getModeAllowedMarketTags(risk, mode),
    },
    'market tag filter blocks entry',
  );
  return false;
}

export async function evaluateCopyMoveGate(
  ds: DataSource,
  move: MoveEventDto,
  entry: WatchlistEntry,
  mode: TradingMode,
  risk: RiskConfig,
  riskService: RiskService,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const isEntry = move.type === 'OPENED' || move.type === 'INCREASED';

  if (isEntry && !entry.active) {
    return { allowed: false, reason: 'Trader inactif pour les entrées' };
  }

  if (
    isEntry &&
    mode === 'sim' &&
    !RiskService.isSimCopyTradingEnabledForConfig(risk)
  ) {
    return { allowed: false, reason: 'Copy trading sim désactivé (config)' };
  }

  if (
    isEntry &&
    mode === 'real' &&
    !RiskService.isRealCopyTradingEnabledForConfig(risk)
  ) {
    return { allowed: false, reason: 'Copy trading réel désactivé (config)' };
  }

  if (!isCopyMoveAllowed(move.type, risk, mode)) {
    const label =
      move.type === 'INCREASED'
        ? 'Recopie des augmentations désactivée'
        : move.type === 'DECREASED'
          ? 'Recopie des réductions désactivée'
          : 'Type de mouvement non autorisé';
    return { allowed: false, reason: label };
  }

  const killSwitch = await riskService.checkKillSwitch(mode);
  if (isEntry && riskService.shouldBlockEntry(killSwitch)) {
    log.warn({ mode }, 'kill switch blocks entry');
    return { allowed: false, reason: 'Kill-switch bloque les entrées' };
  }
  if (riskService.shouldForceCloseAll(killSwitch)) {
    log.warn({ mode }, 'kill switch force_close_all — skipping all signals');
    return {
      allowed: false,
      reason: 'Kill-switch force la fermeture de toutes les positions',
    };
  }
  if (riskService.shouldBlockAndNotify(killSwitch)) {
    log.warn({ mode }, 'kill switch blocks entry (block_and_notify)');
    // Notify backend regardless of entry/exit — the action name promises notification.
    postBackendAlert('/api/internal/kill-switch-alert', {
      mode,
      moveId: move.id,
      reason: 'Kill-switch bloque et notifie',
    });
    if (isEntry) {
      return { allowed: false, reason: 'Kill-switch bloque et notifie' };
    }
  }

  return { allowed: true };
}

export async function canHandleEntry(
  ds: DataSource,
  move: MoveEventDto,
  entry: WatchlistEntry,
  mode: TradingMode,
  risk: RiskConfig,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (move.type === 'OPENED') {
    const blocking = await hasBlockingActivePosition(
      ds,
      entry.id,
      move.conditionId,
      move.assetId,
      mode,
      move.id,
    );
    if (blocking) {
      return { ok: false, reason: 'Position déjà ouverte' };
    }
    return { ok: true };
  }

  if (move.type !== 'INCREASED') return { ok: true };

  const openPos = await findOpenPosition(
    ds,
    entry.id,
    move.conditionId,
    move.assetId,
    mode,
  );
  if (!openPos) {
    return { ok: false, reason: 'Aucune position ouverte à augmenter' };
  }

  if (!isIncreaseAllowed(openPos.increaseCount, risk, mode)) {
    log.warn(
      { moveId: move.id, mode, increaseCount: openPos.increaseCount },
      'increase skipped — max increases reached',
    );
    return { ok: false, reason: "Nombre max d'augmentations atteint" };
  }

  // Use the best available exit bid — never fall back to entryPrice, which would
  // mask losses and incorrectly allow increases on illiquid Polymarket binary markets
  // (order book drains in the last ~60 s before expiry).
  const rawBid = openPos.executableBidVwap ?? openPos.lastCloseableBidVwap ?? null;
  if (rawBid === null) {
    log.warn(
      { moveId: move.id, mode, copiedPositionId: openPos.id },
      'increase blocked — no reliable exit bid (book illiquid, no lastCloseableBidVwap)',
    );
    return {
      ok: false,
      reason: 'Augmentation bloquée — prix de sortie indisponible (marché illiquide)',
    };
  }

  const closure = closurePnlPercent(
    rawBid,
    openPos.entryPrice,
    openPos.entryFeesRemaining ?? 0,
    openPos.entryQuantityRemaining ?? openPos.quantity,
  );
  const slProximity = evaluateCopyIncreaseSlProximity({
    enabled: getModeCopyIncreaseSlProximityEnabled(risk, mode),
    slBidPoints: openPos.slBidPoints,
    entryBidVwap: openPos.entryBidVwap,
    proximityPercent: getModeCopyIncreaseSlProximityPercent(risk, mode),
    closurePnlPercent: closure,
  });
  if (!slProximity.allowed) {
    log.warn(
      {
        moveId: move.id,
        mode,
        copiedPositionId: openPos.id,
        closurePnlPercent: slProximity.closurePnlPercent,
        thresholdPercent: slProximity.thresholdPercent,
      },
      'increase skipped — position too close to stop-loss',
    );
    return { ok: false, reason: slProximity.reason ?? 'Augmentation bloquée — position proche du stop-loss' };
  }

  return { ok: true };
}
