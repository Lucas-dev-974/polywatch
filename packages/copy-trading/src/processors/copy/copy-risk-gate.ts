import {
  closurePnlPercent,
  evaluateCopyIncreaseSlProximity,
  getCopyAllowedMarketTags,
  getCopyCopyIncreaseSlProximityEnabled,
  getCopyCopyIncreaseSlProximityPercent,
  isCopyMoveAllowed,
  isIncreaseAllowed,
  isMarketTagAllowed,
  getCopyKillSwitchAction,
  getCopyMaxDailyLossUsdc,
  WatchlistService,
  type MarketService,
  type CopyConfig,
  type GlobalConfig,
  type MoveEventDto,
  type TradingMode,
  type KillSwitchAction,
} from '@polywatch/core';
import { Execution } from '@polywatch/core';
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { hasBlockingActivePosition, findOpenPosition } from './copy-position-lookup.js';
import { postBackendAlert } from '../../backend-client.js';

const log = pino({ name: 'copy-risk-gate' });

export type WatchlistEntry = NonNullable<
  Awaited<ReturnType<WatchlistService['findByTraderAddress']>>
>;

export function resolveCopyModesWithReasons(
  entry: WatchlistEntry,
  copyConfig: CopyConfig,
  globalConfig: GlobalConfig,
): { modes: TradingMode[]; skippedRealReason?: string } {
  const modes: TradingMode[] = [];
  let skippedRealReason: string | undefined;
  if (entry.simEnabled) modes.push('sim');
  if (entry.realEnabled) {
    if (globalConfig.realTradingEnabled) {
      modes.push('real');
    } else {
      skippedRealReason = 'Trading réel désactivé (config)';
    }
  }
  return { modes, skippedRealReason };
}

function isCopyMarketTagAllowed(
  marketSlugs: string[],
  copyConfig: CopyConfig,
  mode: TradingMode,
): boolean {
  return isMarketTagAllowed(marketSlugs, getCopyAllowedMarketTags(copyConfig, mode));
}

export async function passesMarketTagFilter(
  marketService: MarketService,
  conditionId: string,
  copyConfig: CopyConfig,
  mode: TradingMode,
): Promise<boolean> {
  if (getCopyAllowedMarketTags(copyConfig, mode).length === 0) return true;

  const tagSlugs = await marketService.resolveTagSlugs(conditionId);
  if (isCopyMarketTagAllowed(tagSlugs, copyConfig, mode)) return true;

  log.info(
    {
      mode,
      conditionId,
      tagSlugs,
      allowedTags: getCopyAllowedMarketTags(copyConfig, mode),
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
  copyConfig: CopyConfig,
  globalConfig: GlobalConfig,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const isEntry = move.type === 'OPENED' || move.type === 'INCREASED';

  if (isEntry && !entry.active) {
    return { allowed: false, reason: 'Trader inactif pour les entrées' };
  }

  if (
    isEntry &&
    mode === 'sim' &&
    !copyConfig.simCopyTradingEnabled
  ) {
    return { allowed: false, reason: 'Copy trading sim désactivé (config)' };
  }

  if (
    isEntry &&
    mode === 'real' &&
    !copyConfig.realCopyTradingEnabled
  ) {
    return { allowed: false, reason: 'Copy trading réel désactivé (config)' };
  }

  if (!isCopyMoveAllowed(move.type, copyConfig, mode)) {
    const label =
      move.type === 'INCREASED'
        ? 'Recopie des augmentations désactivée'
        : move.type === 'DECREASED'
          ? 'Recopie des réductions désactivée'
          : 'Type de mouvement non autorisé';
    return { allowed: false, reason: label };
  }

  const killSwitch = await checkCopyKillSwitch(ds, copyConfig, mode);
  if (isEntry && shouldBlockEntry(killSwitch)) {
    log.warn({ mode }, 'kill switch blocks entry');
    return { allowed: false, reason: 'Kill-switch bloque les entrées' };
  }
  if (shouldForceCloseAll(killSwitch)) {
    log.warn({ mode }, 'kill switch force_close_all — skipping all signals');
    return {
      allowed: false,
      reason: 'Kill-switch force la fermeture de toutes les positions',
    };
  }
  if (shouldBlockAndNotify(killSwitch)) {
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

// ─── Inline kill switch helpers (using CopyConfig instead of RiskService) ───

type CopyKillSwitchResult = {
  killSwitchTriggered: boolean;
  blockEntries: boolean;
  action: KillSwitchAction;
};

async function checkCopyKillSwitch(
  ds: DataSource,
  copyConfig: CopyConfig,
  mode: TradingMode,
): Promise<CopyKillSwitchResult> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const result = await ds
    .getRepository(Execution)
    .createQueryBuilder('e')
    .select('COALESCE(SUM(e.realized_pnl), 0)', 'total')
    .where('e.mode = :mode', { mode })
    .andWhere('e.executed_at >= :start', { start: startOfDay })
    .getRawOne<{ total: number }>();

  const dailyNet = result?.total ?? 0;
  const maxDailyLoss = getCopyMaxDailyLossUsdc(copyConfig, mode);
  const triggered = dailyNet < 0 && Math.abs(dailyNet) >= maxDailyLoss;
  const action = getCopyKillSwitchAction(copyConfig, mode) as KillSwitchAction;

  return {
    killSwitchTriggered: triggered,
    blockEntries:
      triggered &&
      (action === 'block_entries' || action === 'block_and_notify'),
    action: triggered ? action : 'block_entries',
  };
}

function shouldBlockEntry(killSwitch: CopyKillSwitchResult): boolean {
  return killSwitch.blockEntries;
}

function shouldForceCloseAll(killSwitch: CopyKillSwitchResult): boolean {
  return killSwitch.killSwitchTriggered && killSwitch.action === 'force_close_all';
}

function shouldBlockAndNotify(killSwitch: CopyKillSwitchResult): boolean {
  return killSwitch.killSwitchTriggered && killSwitch.action === 'block_and_notify';
}

export async function canHandleEntry(
  ds: DataSource,
  move: MoveEventDto,
  entry: WatchlistEntry,
  mode: TradingMode,
  copyConfig: CopyConfig,
  globalConfig: GlobalConfig,
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

  if (!isIncreaseAllowed(openPos.increaseCount, copyConfig, mode)) {
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
    enabled: getCopyCopyIncreaseSlProximityEnabled(copyConfig, mode),
    slBidPoints: openPos.slBidPoints,
    entryBidVwap: openPos.entryBidVwap,
    proximityPercent: getCopyCopyIncreaseSlProximityPercent(copyConfig, mode),
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
