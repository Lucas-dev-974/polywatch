import type { DataSource } from 'typeorm';
import {
  CopiedPosition,
  Execution,
  buildCloseOrderSignal,
  CopyConfigService,
  CryptoConfigService,
  WeatherConfigService,
  getCopyKillSwitchAction,
  getCryptoKillSwitchAction,
  getCopyMaxDailyLossUsdc,
  getCryptoMaxDailyLossUsdc,
  getStrategyParams,
  resolveEnabledWeatherStrategies,
  openingReasonsForAlgoKind,
  algoKindFromReason,
  type OrderSignal,
  type TotalCloseReason,
  type TradingMode,
  type KillSwitchAction,
  type SimAlgoKind,
  type WeatherStrategyId,
} from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from '../../polymarket/connection-manager.js';
import type { RedisQueue } from '../../queue/redis-queue.js';
import { getEffectiveBidVwap } from './position-evaluator.js';

const log = pino({ name: 'kill-switch-monitor' });

export class KillSwitchMonitor {
  private lastKillSwitchCheck = 0;

  constructor(
    private readonly ds: DataSource,
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly closeQueue: RedisQueue<OrderSignal>,
    private readonly copyConfigService: CopyConfigService,
    private readonly cryptoConfigService: CryptoConfigService,
    private readonly weatherConfigService: WeatherConfigService,
  ) {}

  getLastCheckAt(): number {
    return this.lastKillSwitchCheck;
  }

  markChecked(): void {
    this.lastKillSwitchCheck = Date.now();
  }

  shouldCheck(now: number, intervalMs: number): boolean {
    return now - this.lastKillSwitchCheck >= intervalMs;
  }

  async evaluate(): Promise<void> {
    const modes: TradingMode[] = ['sim', 'real'];
    for (const mode of modes) {
      try {
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);

        const [copyCfg, cryptoCfg, weatherCfg] = await Promise.all([
          this.copyConfigService.getConfig(),
          this.cryptoConfigService.getConfig(),
          this.weatherConfigService.getConfig(),
        ]);

        const [copyDailyNet, cryptoDailyNet] = await Promise.all([
          this.getDailyNetForAlgo(mode, 'copy', startOfDay),
          this.getDailyNetForAlgo(mode, 'crypto', startOfDay),
        ]);

        const copyMaxLoss = getCopyMaxDailyLossUsdc(copyCfg, mode);
        const cryptoMaxLoss = getCryptoMaxDailyLossUsdc(cryptoCfg, mode);
        const copyAction = getCopyKillSwitchAction(copyCfg, mode) as KillSwitchAction;
        const cryptoAction = getCryptoKillSwitchAction(cryptoCfg, mode) as KillSwitchAction;

        const copyTriggered = copyDailyNet < 0 && Math.abs(copyDailyNet) >= copyMaxLoss;
        const cryptoTriggered = cryptoDailyNet < 0 && Math.abs(cryptoDailyNet) >= cryptoMaxLoss;

        const results: Array<{ algoKind: SimAlgoKind; strategyId?: string; triggered: boolean; action: string }> = [
          { algoKind: 'copy', triggered: copyTriggered, action: copyAction },
          { algoKind: 'crypto', triggered: cryptoTriggered, action: cryptoAction },
        ];

        // Weather kill-switch is evaluated per strategy: each enabled strategy
        // has its own maxDailyLossUsdc and killSwitchAction.
        const weatherStrategies = resolveEnabledWeatherStrategies(weatherCfg);
        for (const strategyId of weatherStrategies) {
          const bag = getStrategyParams(weatherCfg, strategyId);
          const dailyNet = await this.getDailyNetForAlgo(mode, 'weather', startOfDay, strategyId);
          const triggered = dailyNet < 0 && Math.abs(dailyNet) >= bag.maxDailyLossUsdc;
          results.push({
            algoKind: 'weather',
            strategyId,
            triggered,
            action: bag.killSwitchAction,
          });
        }

        for (const r of results) {
          if (r.triggered && r.action === 'force_close_all') {
            log.warn(
              { mode, algoKind: r.algoKind, strategyId: r.strategyId ?? null },
              'kill switch force_close_all triggered',
            );
            await this.forceCloseAllPositions(mode, r.algoKind, r.strategyId);
          }
        }
      } catch (err) {
        log.warn({ err, mode }, 'kill switch check failed');
      }
    }
    this.markChecked();
  }

  private async getDailyNetForAlgo(
    mode: TradingMode,
    algoKind: SimAlgoKind,
    startOfDay: Date,
    strategyId?: string,
  ): Promise<number> {
    const qb = this.ds
      .getRepository(Execution)
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.realized_pnl), 0)', 'total')
      .innerJoin(CopiedPosition, 'p', 'p.id = e.copied_position_id')
      .where('e.mode = :mode', { mode })
      .andWhere('e.executed_at >= :start', { start: startOfDay })
      .andWhere('p.reason IN (:...reasons)', { reasons: openingReasonsForAlgoKind(algoKind) });
    if (algoKind === 'weather' && strategyId) {
      qb.andWhere('p.strategyId = :strategyId', { strategyId });
    }
    const result = await qb.getRawOne<{ total: number }>();
    return result?.total ?? 0;
  }

  private async forceCloseAllPositions(
    mode: TradingMode,
    algoKind: SimAlgoKind,
    strategyId?: string,
  ): Promise<void> {
    const positions = await this.ds.getRepository(CopiedPosition).find({
      where: { status: 'open', mode },
    });

    for (const pos of positions) {
      if (algoKindFromReason(pos.reason) !== algoKind) continue;
      if (algoKind === 'weather' && strategyId && pos.strategyId !== strategyId) continue;
      const bookPrices = this.connectionManager.getExecutablePrices(
        pos.assetId,
        pos.quantity,
      );
      const bidVwap = getEffectiveBidVwap(pos, bookPrices.executableBidVwap);

      if (bidVwap <= 0) {
        log.warn(
          { positionId: pos.id },
          'force-close skipped — no bid fallback available',
        );
        continue;
      }

      await this.closeQueue.enqueue(
        buildCloseOrderSignal({
          pos: {
            id: pos.id,
            mode: pos.mode,
            conditionId: pos.conditionId,
            assetId: pos.assetId,
            quantity: pos.quantity,
            entryPrice: pos.entryPrice,
            executableBidVwap: pos.executableBidVwap,
            closingAttemptSeq: pos.closingAttemptSeq + 1,
          },
          reason: 'KILL_SWITCH' as TotalCloseReason,
          bidVwap,
        }),
      );

      log.warn({ positionId: pos.id, mode }, 'force-close enqueued');
    }
  }
}
