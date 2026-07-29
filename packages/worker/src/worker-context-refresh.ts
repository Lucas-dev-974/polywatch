import type { DataSource } from 'typeorm';
import type { PolymarketConnectionManager } from './polymarket/connection-manager.js';
import { syncBookSubscriptions } from './polymarket/sync-book-subscriptions.js';
import { UserChannelManager } from './clob/user-channel-manager.js';
import {
  clearTradingContextCache,
  refreshTradingContext,
} from './clob/trading-context.js';
import { GlobalConfigService, CopyConfigService, CryptoConfigService, WeatherConfigService, WatchlistService } from '@polywatch/core';
import type { StrategyProcessing } from './processors/strategy-processing.js';

export interface WorkerContextRefreshOptions {
  ds: DataSource;
  connectionManager: PolymarketConnectionManager;
  userChannel: UserChannelManager;
  strategy: StrategyProcessing;
  syncBooks?: boolean;
  invalidateConfigCache?: boolean;
  evaluateKillSwitch?: boolean;
}

/** Shared refresh path for config-changed and backend-ready handlers. */
export async function refreshWorkerContext(
  options: WorkerContextRefreshOptions,
): Promise<void> {
  const {
    ds,
    connectionManager,
    userChannel,
    strategy,
    syncBooks = true,
    invalidateConfigCache = true,
    evaluateKillSwitch = false,
  } = options;

  clearTradingContextCache();

  if (invalidateConfigCache) {
    WatchlistService.invalidateCache();
    GlobalConfigService.invalidateConfigCache();
    CopyConfigService.invalidateConfigCache();
    CryptoConfigService.invalidateConfigCache();
    WeatherConfigService.invalidateConfigCache();
  }

  const ctx = await refreshTradingContext();
  if (!ctx) {
    userChannel.disconnect();
    return;
  }

  await userChannel.ensureConnected(ctx.wsAuth);

  if (evaluateKillSwitch) {
    await strategy.evaluateKillSwitch();
  }

  if (syncBooks) {
    await syncBookSubscriptions(ds, connectionManager);
  }
}
