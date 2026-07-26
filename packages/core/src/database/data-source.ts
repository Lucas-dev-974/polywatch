import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';

import {
  AlgoAutoTrackRule,
  AlgoMarketSelection,
  AlgoSurveillanceSnapshot,
  AlgoPriceTick,
  ClobCredentials,
  CopiedPosition,
  Execution,
  ExitAttemptEvent,
  IntegrationSettings,
  Market,
  MarketPositionTick,
  MarketPriceTick,
  MarketPriceHistorySync,
  MarketSyncConfig,
  MoveEventEntity,
  PositionReservation,
  RiskConfig,
  SimulationBalance,
  SimulationSession,
  SimulationStateSnapshot,
  AnalysisReport,
  RiskConfigRevision,
  SystemConfig,
  TraderSnapshot,
  TraderSnapshotSeq,
  User,
  WalletAccount,
  WatchlistEntry,
  E2eTestRun,
  E2eRunPosition,
  SimArchivePosition,
  SimArchiveExecution,
  SimArchiveExitAttempt,
  SimArchiveSurveillance,
  SimArchivePriceCandle,
  RealSession,
  RealSessionState,
  RealStateSnapshot,
  RealArchivePosition,
  RealArchiveExecution,
  RealArchiveExitAttempt,
  WeatherMarketSelection,
  WeatherAutoTrackRule,
  WeatherForecastCache,
  WeatherPositionForecast,
} from '../entities/index.js';
import { getDatabaseUrl } from '../config/env.js';
import { Baseline1700000000000 } from '../migrations/Baseline1700000000000.js';
import { AddSnapshotIndexes1700000000001 } from '../migrations/AddSnapshotIndexes1700000000001.js';
import { AddSnapshotRetentionColumns1700000000002 } from '../migrations/AddSnapshotRetentionColumns1700000000002.js';
import { AddCopyIncreaseSlProximity1700000000003 } from '../migrations/AddCopyIncreaseSlProximity1700000000003.js';
import { CreateAlgoMarketSelections1700000000004 } from '../migrations/CreateAlgoMarketSelections1700000000004.js';
import { AddReasonToCopiedPositions1700000000005 } from '../migrations/AddReasonToCopiedPositions1700000000005.js';
import { AddCryptoAlgoRiskConfig1700000000006 } from '../migrations/AddCryptoAlgoRiskConfig1700000000006.js';
import { AddRealCashOverride1700000000007 } from '../migrations/AddRealCashOverride1700000000007.js';
import { CreateAlgoAutoTrackRules1700000000008 } from '../migrations/CreateAlgoAutoTrackRules1700000000008.js';
import { CreateAlgoSurveillanceSnapshots1700000000009 } from '../migrations/CreateAlgoSurveillanceSnapshots1700000000009.js';
import { AddSlCloseMaxRetries1700000000010 } from '../migrations/AddSlCloseMaxRetries1700000000010.js';
import { AddUnresolvedAtToAlgoSurveillanceSnapshots1700000000011 } from '../migrations/AddUnresolvedAtToAlgoSurveillanceSnapshots1700000000011.js';
import { AddCryptoAlgoPreCloseRiskConfig1700000000012 } from '../migrations/AddCryptoAlgoPreCloseRiskConfig1700000000012.js';
import { AddCryptoAlgoExitPlanV21700000000013 } from '../migrations/AddCryptoAlgoExitPlanV21700000000013.js';
import { CreateMarketPositionTicks1700000000014 } from '../migrations/CreateMarketPositionTicks1700000000014.js';
import { AddMarketPositionTicksCreatedAtIndex1700000000015 } from '../migrations/AddMarketPositionTicksCreatedAtIndex1700000000015.js';
import { CreateE2eTestRuns1700000000016 } from '../migrations/CreateE2eTestRuns1700000000016.js';
import { CreateE2eRunPositions1700000000017 } from '../migrations/CreateE2eRunPositions1700000000017.js';
import { AddSimCopyTradingEnabled1700000000018 } from '../migrations/AddSimCopyTradingEnabled1700000000018.js';
import { CreateAlgoPriceTicks1700000000019 } from '../migrations/CreateAlgoPriceTicks1700000000019.js';
import { AddCryptoAlgoPreCloseWinConfidenceBid1700000000020 } from '../migrations/AddCryptoAlgoPreCloseWinConfidenceBid1700000000020.js';
import { AddAlgoPriceTickMetrics1700000000021 } from '../migrations/AddAlgoPriceTickMetrics1700000000021.js';
import { AddAlgoPriceTickLiquidityStatus1700000000022 } from '../migrations/AddAlgoPriceTickLiquidityStatus1700000000022.js';
import { AddCryptoAlgoTimeExit1700000000023 } from '../migrations/AddCryptoAlgoTimeExit1700000000023.js';
import { AddCryptoAlgoExitDefaults1700000000024 } from '../migrations/AddCryptoAlgoExitDefaults1700000000024.js';
import { AddCryptoAlgoBidAbsoluteSlTp1700000000025 } from '../migrations/AddCryptoAlgoBidAbsoluteSlTp1700000000025.js';
import { AddCryptoAlgoPriceTickCleanupConfig1700000000026 } from '../migrations/AddCryptoAlgoPriceTickCleanupConfig1700000000026.js';
import { CreateMarketPriceTicks1700000000027 } from '../migrations/CreateMarketPriceTicks1700000000027.js';
import { ReplaceMarketPriceTicks1700000000028 } from '../migrations/ReplaceMarketPriceTicks1700000000028.js';
import { CreateMarketPriceHistorySync1700000000029 } from '../migrations/CreateMarketPriceHistorySync1700000000029.js';
import { CreateMarketSyncConfig1700000000030 } from '../migrations/CreateMarketSyncConfig1700000000030.js';
import { AddMarketType1700000000031 } from '../migrations/AddMarketType1700000000031.js';
import { AddCopyBidPointsRiskConfig1700000000032 } from '../migrations/AddCopyBidPointsRiskConfig1700000000032.js';
import { AddSlConfirmationTicksRiskConfig1700000000033 } from '../migrations/AddSlConfirmationTicksRiskConfig1700000000033.js';
import { AddForcedExitAttemptTracking1700000000034 } from '../migrations/AddForcedExitAttemptTracking1700000000034.js';
import { AddExitEmitBlockTracking1700000000035 } from '../migrations/AddExitEmitBlockTracking1700000000035.js';
import { CreateExitAttemptEvents1700000000036 } from '../migrations/CreateExitAttemptEvents1700000000036.js';
import { AddMarkBidToExitAttemptEvents1700000000037 } from '../migrations/AddMarkBidToExitAttemptEvents1700000000037.js';
import { AddCryptoAlgoReEntryConfig1700000000038 } from '../migrations/AddCryptoAlgoReEntryConfig1700000000038.js';
import { AddAbstainReasonToAlgoPriceTicks1700000000039 } from '../migrations/AddAbstainReasonToAlgoPriceTicks1700000000039.js';
import { AddCryptoAlgoTunables1700000000040 } from '../migrations/AddCryptoAlgoTunables1700000000040.js';
import { AddMarketOutcomes1700000000041 } from '../migrations/AddMarketOutcomes1700000000041.js';
import { SplitSlTpEnabledFlags1700000000042 } from '../migrations/SplitSlTpEnabledFlags1700000000042.js';
import { AddSimRealismConfig1700000000043 } from '../migrations/AddSimRealismConfig1700000000043.js';
import { AddCryptoAlgoSlQuotaConfig1700000000044 } from '../migrations/AddCryptoAlgoSlQuotaConfig1700000000044.js';
import { AddSnapshotSystemV2170000000045 } from '../migrations/AddSnapshotSystemV2170000000045.js';
import { AddSimulationSessions1700000000046 } from '../migrations/AddSimulationSessions1700000000046.js';
import { AddAnalysisReportsAndRiskConfigRevisions1700000000047 } from '../migrations/AddAnalysisReportsAndRiskConfigRevisions1700000000047.js';
import { AddCopiedPositionClosingReason1700000000048 } from '../migrations/AddCopiedPositionClosingReason1700000000048.js';
import { AddSimSessionArchives1700000000049 } from '../migrations/AddSimSessionArchives1700000000049.js';
import { AddEntryShareCountRiskConfig1700000000050 } from '../migrations/AddEntryShareCountRiskConfig1700000000050.js';
import { AddRealSessions1700000000051 } from '../migrations/AddRealSessions1700000000051.js';
import { AddEntryDepthRetryRiskConfig1700000000052 } from '../migrations/AddEntryDepthRetryRiskConfig1700000000052.js';
import { BumpSimAlgoEntrySizing1700000000053 } from '../migrations/BumpSimAlgoEntrySizing1700000000053.js';
import { ReducePlacingJanitorInterval1700000000054 } from '../migrations/ReducePlacingJanitorInterval1700000000054.js';
import { AddRealCopyTradingEnabled1700000000055 } from '../migrations/AddRealCopyTradingEnabled1700000000055.js';
import { AddCryptoAlgoEntryPriceBand1700000000056 } from '../migrations/AddCryptoAlgoEntryPriceBand1700000000056.js';
import { AlignRiskConfigWithEntityV2170000000057 } from '../migrations/AlignRiskConfigWithEntityV2170000000057.js';
import { AddSessionConfigJson1700000000058 } from '../migrations/AddSessionConfigJson1700000000058.js';
import { DropSnapshotConfigJson1700000000059 } from '../migrations/DropSnapshotConfigJson1700000000059.js';
import { AddSlippagePercentToExecutions1700000000060 } from '../migrations/AddSlippagePercentToExecutions1700000000060.js';
import { AddCryptoAlgoCurveFilter1700000000061 } from '../migrations/AddCryptoAlgoCurveFilter1700000000061.js';
import { SystemConfig1700000000001 } from '../migrations/SystemConfig1700000000001.js';
import { CreateWeatherAlgo1700000000070 } from '../migrations/CreateWeatherAlgo1700000000070.js';
import { WeatherAlgoUniqueIndexes1700000000080 } from '../migrations/WeatherAlgoUniqueIndexes1700000000080.js';
import { WeatherPositionForecastUnique1700000000081 } from '../migrations/WeatherPositionForecastUnique1700000000081.js';
import { WeatherCityFollow1700000000082 } from '../migrations/WeatherCityFollow1700000000082.js';

import { ClobLatencySample } from '../entities/ClobLatencySample.js';
import { ShadowFill } from '../entities/ShadowFill.js';

export const migrations = [
  Baseline1700000000000,
  AddSnapshotIndexes1700000000001,
  AddSnapshotRetentionColumns1700000000002,
  AddCopyIncreaseSlProximity1700000000003,
  CreateAlgoMarketSelections1700000000004,
  AddReasonToCopiedPositions1700000000005,
  AddCryptoAlgoRiskConfig1700000000006,
  AddRealCashOverride1700000000007,
  CreateAlgoAutoTrackRules1700000000008,
  CreateAlgoSurveillanceSnapshots1700000000009,
  AddSlCloseMaxRetries1700000000010,
  AddUnresolvedAtToAlgoSurveillanceSnapshots1700000000011,
  AddCryptoAlgoPreCloseRiskConfig1700000000012,
  AddCryptoAlgoExitPlanV21700000000013,
  CreateMarketPositionTicks1700000000014,
  AddMarketPositionTicksCreatedAtIndex1700000000015,
  CreateE2eTestRuns1700000000016,
  CreateE2eRunPositions1700000000017,
  AddSimCopyTradingEnabled1700000000018,
  CreateAlgoPriceTicks1700000000019,
  AddCryptoAlgoPreCloseWinConfidenceBid1700000000020,
  AddAlgoPriceTickMetrics1700000000021,
  AddAlgoPriceTickLiquidityStatus1700000000022,
  AddCryptoAlgoTimeExit1700000000023,
  AddCryptoAlgoExitDefaults1700000000024,
  AddCryptoAlgoBidAbsoluteSlTp1700000000025,
  AddCryptoAlgoPriceTickCleanupConfig1700000000026,
  CreateMarketPriceTicks1700000000027,
  ReplaceMarketPriceTicks1700000000028,
  CreateMarketPriceHistorySync1700000000029,
  CreateMarketSyncConfig1700000000030,
  AddMarketType1700000000031,
  AddCopyBidPointsRiskConfig1700000000032,
  AddSlConfirmationTicksRiskConfig1700000000033,
  AddForcedExitAttemptTracking1700000000034,
  AddExitEmitBlockTracking1700000000035,
  CreateExitAttemptEvents1700000000036,
  AddMarkBidToExitAttemptEvents1700000000037,
  AddCryptoAlgoReEntryConfig1700000000038,
  AddAbstainReasonToAlgoPriceTicks1700000000039,
  AddCryptoAlgoTunables1700000000040,
  AddMarketOutcomes1700000000041,
  SplitSlTpEnabledFlags1700000000042,
  AddSimRealismConfig1700000000043,
  AddCryptoAlgoSlQuotaConfig1700000000044,
  AddSnapshotSystemV2170000000045,
  AddSimulationSessions1700000000046,
  AddAnalysisReportsAndRiskConfigRevisions1700000000047,
  AddCopiedPositionClosingReason1700000000048,
  AddSimSessionArchives1700000000049,
  AddEntryShareCountRiskConfig1700000000050,
  AddRealSessions1700000000051,
  AddEntryDepthRetryRiskConfig1700000000052,
  BumpSimAlgoEntrySizing1700000000053,
  ReducePlacingJanitorInterval1700000000054,
  AddRealCopyTradingEnabled1700000000055,
  AddCryptoAlgoEntryPriceBand1700000000056,
  AlignRiskConfigWithEntityV2170000000057,
  AddSessionConfigJson1700000000058,
  DropSnapshotConfigJson1700000000059,
  AddSlippagePercentToExecutions1700000000060,
  AddCryptoAlgoCurveFilter1700000000061,
  SystemConfig1700000000001,
  CreateWeatherAlgo1700000000070,
  WeatherAlgoUniqueIndexes1700000000080,
  WeatherPositionForecastUnique1700000000081,
  WeatherCityFollow1700000000082,
];

export const entities = [
  User,
  WatchlistEntry,
  RiskConfig,
  ClobCredentials,
  IntegrationSettings,
  WalletAccount,
  TraderSnapshot,
  TraderSnapshotSeq,
  MoveEventEntity,
  CopiedPosition,
  Execution,
  ExitAttemptEvent,
  PositionReservation,
  SimulationBalance,
  SimulationSession,
  SimulationStateSnapshot,
  AnalysisReport,
  RiskConfigRevision,
  Market,
  AlgoMarketSelection,
  AlgoAutoTrackRule,
  AlgoSurveillanceSnapshot,
  AlgoPriceTick,
  MarketPositionTick,
  MarketPriceTick,
  MarketPriceHistorySync,
  MarketSyncConfig,
  SystemConfig,
  E2eTestRun,
  E2eRunPosition,
  ClobLatencySample,
  ShadowFill,
  SimArchivePosition,
  SimArchiveExecution,
  SimArchiveExitAttempt,
  SimArchiveSurveillance,
  SimArchivePriceCandle,
  RealSession,
  RealSessionState,
  RealStateSnapshot,
  RealArchivePosition,
  RealArchiveExecution,
  RealArchiveExitAttempt,
  WeatherMarketSelection,
  WeatherAutoTrackRule,
  WeatherForecastCache,
  WeatherPositionForecast,
];

/**
 * Resolve whether synchronize is allowed.
 * Hard-disable synchronize in production unless ALLOW_SYNCHRONIZE_PROD is set.
 */
function resolveSynchronize(requested = false): boolean {
  if (requested && process.env.NODE_ENV === 'production' && !process.env.ALLOW_SYNCHRONIZE_PROD) {
    return false;
  }
  return requested;
}

/**
 * Build DataSourceOptions for PostgreSQL.
 */
export function buildDataSourceOptions(opts?: {
  synchronize?: boolean;
  migrationsRun?: boolean;
}): DataSourceOptions {
  const synchronize = resolveSynchronize(opts?.synchronize);
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL must be set');
  }
  return {
    type: 'postgres',
    url,
    entities,
    synchronize,
    migrationsRun: opts?.migrationsRun ?? true,
    migrations,
    logging: false,
    extra: {
      statement_timeout: 30_000,
      lock_timeout: 10_000,
    },
  };
}

/**
 * Create a PostgreSQL DataSource.
 * DATABASE_URL must be set in the environment.
 */
export function createDataSource(opts?: {
  synchronize?: boolean;
  migrationsRun?: boolean;
}): DataSource {
  return new DataSource(buildDataSourceOptions(opts));
}

/**
 * Create a DataSource that runs TypeORM migrations instead of synchronize.
 * Used by migrate.ts for safe schema management in production.
 * synchronize is always false here — schema changes go through migrations.
 */
export function createMigratorDataSource(): DataSource {
  return createDataSource({ synchronize: false, migrationsRun: false });
}

/**
 * Create a PostgreSQL DataSource from a connection URL.
 * Useful for tests or tools that need a direct connection.
 */
export function createPostgresDataSource(
  url: string,
  opts?: { synchronize?: boolean },
): DataSource {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  try {
    return new DataSource(buildDataSourceOptions({ synchronize: opts?.synchronize, migrationsRun: false }));
  } finally {
    if (previousUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousUrl;
    }
  }
}

export async function initializeDataSource(ds: DataSource): Promise<DataSource> {
  if (!ds.isInitialized) {
    await ds.initialize();
  }
  return ds;
}

export async function assertDatabaseExists(ds: DataSource): Promise<void> {
  const result = await ds.query(
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const tableCount = Number(result[0]?.count ?? 0);

  if (tableCount === 0) {
    throw new Error(
      'Database is empty -- run "npm run migrate -w packages/core" first to create tables.',
    );
  }
}