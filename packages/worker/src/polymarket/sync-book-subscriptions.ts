import { fetchGammaMarketsByTagSlug, marketClassifier } from '@polywatch/core';
import type { DataSource } from 'typeorm';
import {
  CopiedPositionService,
  loadAlgoSelectionBookAssets,
  mergeBookAssetMaps,
} from '@polywatch/core';
import pino from 'pino';
import type { PolymarketConnectionManager } from './connection-manager.js';
import { STALE_BOOK_THRESHOLD_MS } from '../constants.js';

const log = pino({ name: 'sync-book-subscriptions' });

let syncInFlight: Promise<void> | null = null;

/** Short-lived cache for Up/Down market discovery to avoid hammering Gamma API
 * when many executions finalize in quick succession (e.g. crypto-algo openings). */
let upDownMarketCache: {
  data: UpDownMarketAssets;
  fetchedAt: number;
} | null = null;

const UP_DOWN_MARKET_CACHE_TTL_MS = 30_000;

/**
 * Tag slugs that contain Polymarket "Up or Down" interval markets.
 * We also keep 'crypto' as a fallback for any Up/Down markets that may be
 * classified under the broad crypto tag.
 */
const UG_PERCENT_MARKET_TAG_SLUGS = ['crypto', '5M', '15M', '1H', '4H'];
const UG_PERCENT_FETCH_LIMIT = 100;

interface UpDownMarketAssets {
  assetIds: string[];
  /** Maps each subscribed assetId to its outcome label for percent updates. */
  outcomeByAssetId: Map<string, string>;
  /** Maps each subscribed assetId to its conditionId. */
  conditionIdByAssetId: Map<string, string>;
}

/**
 * Vérifie si un marché est un Up/Down crypto en utilisant le classifieur centralisé.
 * Remplace l'ancienne fonction locale `isUpDownMarket` qui utilisait une regex différente.
 * (Correction §9.8 : 4e point de duplication éliminé)
 */
function isUpDownMarket(question: string | null): boolean {
  return marketClassifier.classifyCryptoCategory(question) === 'up-down';
}

/**
 * Discover active crypto Up/Down markets across all relevant Gamma tags and
 * return the Yes/No assetIds the worker should subscribe to on the CLOB WebSocket.
 */
export async function loadUpDownMarketAssets(): Promise<UpDownMarketAssets> {
  const now = Date.now();
  if (upDownMarketCache && now - upDownMarketCache.fetchedAt < UP_DOWN_MARKET_CACHE_TTL_MS) {
    return upDownMarketCache.data;
  }

  try {
    const assetIds: string[] = [];
    const outcomeByAssetId = new Map<string, string>();
    const conditionIdByAssetId = new Map<string, string>();

    let totalItems = 0;
    let upDownCount = 0;
    let missingTokens = 0;
    let wrongOutcomeCount = 0;
    const seenConditionIds = new Set<string>();

    for (const tagSlug of UG_PERCENT_MARKET_TAG_SLUGS) {
      const result = await fetchGammaMarketsByTagSlug({
        tagSlug,
        limit: UG_PERCENT_FETCH_LIMIT,
        offset: 0,
        closed: false,
      });

      for (const item of result.items) {
        totalItems++;

        // Accept both the explicit crypto category and the "Up or Down" question pattern.
        if (item.cryptoCategory !== 'up-down' && !isUpDownMarket(item.question)) {
          log.trace(
            { conditionId: item.conditionId, category: item.cryptoCategory, question: item.question },
            'market is not up-down category',
          );
          continue;
        }

        // De-duplicate across tags using conditionId.
        if (seenConditionIds.has(item.conditionId)) {
          continue;
        }
        seenConditionIds.add(item.conditionId);
        upDownCount++;

        if (item.outcomePrices.length !== 2) {
          wrongOutcomeCount++;
          log.debug(
            { conditionId: item.conditionId, outcomes: item.outcomePrices.length },
            'skipping Up/Down market with wrong outcome count',
          );
          continue;
        }

        if (!item.tokenIdYes || !item.tokenIdNo) {
          missingTokens++;
          log.debug(
            { conditionId: item.conditionId, hasYes: !!item.tokenIdYes, hasNo: !!item.tokenIdNo },
            'skipping Up/Down market with incomplete token metadata',
          );
          continue;
        }

        const yes = item.tokenIdYes;
        const no = item.tokenIdNo;
        assetIds.push(yes, no);
        outcomeByAssetId.set(yes, 'up');
        outcomeByAssetId.set(no, 'down');
        conditionIdByAssetId.set(yes, item.conditionId);
        conditionIdByAssetId.set(no, item.conditionId);
      }
    }

    log.info(
      {
        totalItems,
        tags: UG_PERCENT_MARKET_TAG_SLUGS,
        upDownCount,
        missingTokens,
        wrongOutcomeCount,
        upDownAssetIds: assetIds.length,
      },
      'loaded Up/Down browse-grid market assetIds',
    );

    const result: UpDownMarketAssets = {
      assetIds,
      outcomeByAssetId,
      conditionIdByAssetId,
    };
    upDownMarketCache = { data: result, fetchedAt: Date.now() };
    return result;
  } catch (err) {
    log.error(err, 'failed to load Up/Down markets');
    return { assetIds: [], outcomeByAssetId: new Map(), conditionIdByAssetId: new Map() };
  }
}

/**
 * Reconcile active WebSocket book subscriptions based on current open/closing/pending positions
 * plus the active Up/Down browse-grid markets.
 *
 * Uses the WebSocket client under the hood, falling back to REST snapshots for initial load.
 */
export async function syncBookSubscriptions(
  ds: DataSource,
  connectionManager: PolymarketConnectionManager,
  refresh = true,
  positionService?: CopiedPositionService,
): Promise<void> {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = runSyncBookSubscriptions(
    ds,
    connectionManager,
    refresh,
    positionService,
  ).finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

async function runSyncBookSubscriptions(
  ds: DataSource,
  connectionManager: PolymarketConnectionManager,
  refresh = true,
  positionService?: CopiedPositionService,
): Promise<void> {
  const svc = positionService ?? new CopiedPositionService(ds);
  const active = await svc.loadActive();
  const upDown = await loadUpDownMarketAssets();
  const algoSelections = await loadAlgoSelectionBookAssets(ds);
  const browseMeta = mergeBookAssetMaps(upDown, algoSelections);

  const positionAssetIds = active.map((p) => p.assetId);
  const allAssetIds = [
    ...new Set([
      ...positionAssetIds,
      ...browseMeta.assetIds,
    ]),
  ];

  log.info(
    {
      positionAssetIds: positionAssetIds.length,
      browseAssetIds: upDown.assetIds.length,
      algoSelectionAssetIds: algoSelections.assetIds.length,
      totalAssetIds: allAssetIds.length,
    },
    'reconciling WebSocket book subscriptions',
  );

  connectionManager.setBrowseMarketMeta(
    browseMeta.conditionIdByAssetId,
    browseMeta.outcomeByAssetId,
  );

  // Reconcile local asset tracking
  connectionManager.reconcileActiveAssets(allAssetIds);

  // Reconcile WebSocket subscriptions
  const wsClient = connectionManager.getWsClient();
  wsClient.reconcile(allAssetIds);

  // Refresh cached books (syncs snapshots or triggers WS re-sync).
  // Gate: only re-fetches from REST for books older than STALE_BOOK_THRESHOLD_MS
  // when WS is healthy; re-syncs everything when WS is down.
  if (refresh) {
    await wsClient.syncAll(STALE_BOOK_THRESHOLD_MS);
    await connectionManager.refreshAllActive();
  }
}
