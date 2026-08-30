# Package `@polywatch/worker`

Processus d'exécution : stratégie SL/TP, exécution (simulation et CLOB réel), réconciliation, janitors.

> La détection copy (polling traders, pipelines entry/exit) vit dans `@polywatch/copy-trading`.
> Voir [`02-pipeline-copy-trading.md`](02-pipeline-copy-trading.md).

## Démarrage (`index.ts`)

1. Initialisation PostgreSQL (TypeORM, schéma vérifié par `assertDatabaseExists`).
2. **`ensureCashIntegrity()`** — réconciliation du cash simulation depuis le ledger d'exécutions (log si drift réparé).
3. Plusieurs connexions Redis dédiées : commandes, pub (heartbeat), sub (`config-changed`, `backend-ready`), et connexions consommateurs dédiées (`order-signals`, `algo-order-signals`, `weather-order-signals`, `close-signals`, `execution-results`).
4. `waitForBackendReady()` — attend le signal Redis `backend-ready` (timeout 60 s) avant de continuer.
5. `reconcilePlacingExecutions` (exécutions réelles orphelines en `placing`).
6. **`startup-reconciler.ts`** — Réconciliation au démarrage : positions, exécutions, réservations.
7. **`worker-context-refresh.ts`** — Abonnements Redis `config-changed` / `backend-ready` ; refresh du contexte trading (debounce 5 s).
8. `backfillClosingStartedAt()` — backfill colonne legacy.
9. `reconcileClosingOnClosedClob()` — révertit les positions `closing`/`closed` dont le marché a `accepting_orders=false` (clôture invalide suite CLOB fermé).
10. `recoverOrphans()` sur les files d'exécution (`order-signals`, `algo-order-signals`, `weather-order-signals`, `close-signals`, `execution-results` — clés `:processing` → files normales).
11. Connexion WebSocket **book** + `syncBookSubscriptions` (10 s) ; WebSocket **user** (`UserChannelManager`).
12. Boucles : strategy (100 ms), market-resolution (**15 s**), redemption (15 s), closing-watchdog (15 s), placing-janitor (15 s défaut, sim-only), pending-entry-janitor (30 s), reservation-janitor (60 s).
13. Abonnements Redis (dispatcher `Map<channel, handler>` — `messageHandlers`) :
    - **`config-changed`** : purge cache TradingContext, resync WS, réévaluation kill switch. Handler enveloppé dans `try/catch` (log error, worker continue).
    - **`backend-ready`** : refresh trading context (debounce 5 s via `refreshWorkerContext`). `.catch()` sur la promesse (log warn).
    - **`simulation-reset`** : bump `SimResetGeneration` + log ; les queues sim sont purgées par le backend ; un échec de job `mode=sim` en vol est converti en `JobDiscardedError` (pas de RPUSH post-purge).
    - **`algo-selections-changed`** : debounce 2 s → `syncBookSubscriptions` avec `.catch()`.
    - Canal inconnu → `log.warn`.

## Resilience patterns

- **`safeInterval`** (`helpers.ts`) : wrap `setInterval` avec `.catch()` — toute rejection dans une boucle périodique est loguée, pas crash.
- **`evaluateAll()`** (`strategy-processing.ts`) : `try/catch/finally` — une erreur DB ou WS pendant l'évaluation est loguée (`log.error`), le flag `evaluating` est reset, et un rerun est re-déclenché si demandé. Aucun `void evaluateAll()` ne peut produire une unhandled rejection.
- **Queue consumers** (`startConsumer`) : `.catch()` avec `log.fatal` + `process.exit(1)` sauf si `shuttingDown` (SIGTERM/SIGINT) — alors log info uniquement, comme copy-trading.
- **`sim-reset-guard.ts`** : `wrapSimResetAwareHandler` + `JobDiscardedError` (`@polywatch/core` RedisQueue) pour éviter la réinjection d'un job sim après purge.
- **Debounce timers** : `algoSelectionsSyncTimer`, `backendReadyDebounceTimer`, `marketResolvedDebounce` — tous nettoyés dans le `shutdown()` avant `clearInterval` des boucles périodiques.

## Processors (files Redis)

| Fichier | File consommée | Rôle |
|---|---|---|
| `executor.ts` | `order-signals` / `algo-order-signals` / `weather-order-signals` / `close-signals` | Verrou position, claim + réconciliation in-flight, mos sortie, exécution sim/réelle → `execution-results`. Consomme `COPY_*`, `ALGO_*`, `WEATHER_OPEN` / closes `WEATHER_FORECAST_CHANGE` / `WEATHER_BUCKET_EXIT`. Sim FAK : `forceRefreshBook` avant prepare (comme le réel) puis match T1 ; profondeur vide ou insuffisante au limit → `order_not_matched` (pas de fill partiel fantôme). |
| `results-consumer.ts` | `execution-results` | `completeExecution` sous `positionLocks` → finalize + retry sorties forcées |
| `strategy-processing.ts` | — (100 ms + book updates) | Boucle principale ; délègue à `position-exit-evaluator` et `kill-switch-monitor` → `close-signals` |
| `market-resolution-watcher.ts` | — (**15 s**) | Délègue à `MarketResolutionService` |
| `redemption-handler.ts` | — (15 s) | Rédemption `pending_resolution` **et `failed`** (qty > 0). Envoie `assetId` à `POST /api/internal/redeem`. Refuse clôture si `amountRedeemedRaw === '0'` (`redemption_failed: zero_payout`). Traite `no_ctf_balance` → `filled` (parts déjà brûlées on-chain). |

### Module stratégie (`processors/strategy/`)

| Fichier | Rôle |
|---|---|
| `strategy-processing.ts` | Boucle 100 ms, refresh marchés near-end, orchestration |
| `position-exit-evaluator.ts` | SL/TP/trailing, pre-close |
| `kill-switch-monitor.ts` | Force-close si perte journalière ≥ seuil. Weather : **par stratégie** (`dailyRealizedPnl(strategyId)`), pas toutes les positions du ledger |
| `position-branches.ts` | Branches liquide / illiquide, peak PnL |
| `pnl-tick-publisher.ts` | Push PnL ticks vers backend |
| `market-percent-publisher.ts` | Push variations % marché au backend sur book update |
| `market-tick-publisher.ts` | Push ticks marché vers le backend |
| `position-evaluator.ts` | Évaluation des positions pour décision de sortie |

## Market tracking (`processors/market-tracking/`)

Pipeline auxiliaire déclenché sur chaque mise à jour de carnet :

| Fichier | Rôle |
|---|---|
| `open-position-tracker.ts` | Index mémoire des positions ouvertes par `assetId` (refresh périodique) |
| `market-tick-recorder.ts` | Persiste `MarketPositionTick` (throttle 500 ms/asset) pour les positions ouvertes |
| `market-price-history-syncer.ts` | Sync / persistance `MarketPriceTick` par `conditionId` (graphique UI non-crypto) |

**Purge automatique désactivée** : les timers `marketTickPurgeTimer` / `marketPriceTickPurgeTimer` ont été retirés (`packages/worker/src/index.ts`). `MARKET_TICK_RETENTION_DAYS` / `MARKET_PRICE_TICK_RETENTION_DAYS` restent la rétention théorique ; nettoyage manuel via API/scripts.

## Module CLOB (`clob/`)

| Fichier | Rôle |
|---|---|
| `trading-context.ts` | Cache singleton (TTL 30 min) : ClobClient POLY_1271, deposit wallet, credentials WS. Sync collatéral CLOB au load (pas de gate 7-approvals). `ensureOrderClobApprovals` (POST ensure avec `negRisk`+`side`, timeout 90 s) **juste avant le post** d'un ordre réel, puis sync si tx minée. Sync périodique 5 min. Invalidé par `config-changed` / `backend-ready`. Compteur `cacheGeneration` : un build en vol ne réécrit jamais le cache après une invalidation |
| `client-factory.ts` / `credentials.ts` | Construction du ClobClient ; credentials via `/api/internal/clob-credentials` |
| `real-executor.ts` | REST `forceRefreshBook` puis prepare FAK (prix → slippage tick-aware → tick → **mos (SELL)** → `lastTradePrice` sorties forcées) → `ensureOrderClobApprovals` (famille+side, pas un gate 7-en-1) → post (timeout 30 s). BUY `WEATHER_OPEN` : pad `entryTickPad` (défaut 1) après le guard |
| `execution-reconciler.ts` | Réconciliation `getOrder` / `getTrades` |
| `min-order-size.ts` | `resolveMinOrderShares` : mos CLOB → book → fallback |
| `position-lock-registry.ts` | Mutex par `copiedPositionId` — Executor, ResultsConsumer, UserChannelHandler |
| `user-channel-manager.ts` / `user-channel-handler.ts` | WS user : order UPDATE prioritaire ; finalisation directe (bypass queue) |
| `backend-readiness.ts` | Attente canal Redis `backend-ready` |

## Exécution (`clob/` et `execution/`)

| Fichier | Rôle |
|---|---|
| `clob/execution-completion.ts` | Finalisation d'exécution CLOB |
| `clob/notify-execution.ts` | Notification backend avec circuit breaker |
| `clob/prepare-fak-order.ts` | Pré-ordre FAK partagé sim/réel : book (frais 15 s pour `COPY_OPEN` / `ALGO_OPEN` / `WEATHER_OPEN` BUY), slippage **tick-aware**, arrondi BUY `ceilToTick` / SELL `floorToTick`, pad `entryTickPad` BUY `WEATHER_OPEN` après le guard, MOS sortie, `lastTradePrice` SELL |
| `execution/slippage-guard.ts` | Protection slippage avant envoi ordre. `computeSlippagePercent(fill, ref, side)` est **signé** (BUY : > 0 si trop cher ; SELL : > 0 si trop bas) ; le guard ne bloque que le slippage **défavorable** — un fill plus avantageux que le VWAP de référence passe toujours. Sans `side`, fallback sur la distance absolue (métriques legacy). Cap effectif = `max(maxSlippagePercent, MIN_SLIPPAGE_TICKS × tick / referenceVwap × 100)` (`MIN_SLIPPAGE_TICKS = 2`) pour ne pas rejeter un mouvement d'1–2 ticks sur un token à 1–5 ¢ |
| `execution/sl-close-retry.ts` | Retry des forced exits (SL, trailing, kill-switch) |
| `execution/latency-calibrator.ts` | Latence sim calibrée depuis échantillons RTT réels (`clob_latency_samples`) |
| `execution/self-impact-registry.ts` | Auto-impact liquidité : profondeur consommée par fills sim récents (TTL mémoire) |
| `execution/sim-wallet-preflight.ts` | Préflight wallet read-only sur BUY sim (balance USDC) |
| `execution/shadow-fill-recorder.ts` | Shadow logging : compare fill réel vs FAK local sur book cache |
| `watchdogs/sim-realism-janitor.ts` | Purge horaire `clob_latency_samples` / `shadow_fills` (rétention `GlobalConfig`) |

Voir aussi [`../reference/simulation-execution.md`](../reference/simulation-execution.md) pour le pipeline sim complet et les tunables `GlobalConfig`.

## WebSockets Polymarket (`polymarket/`)

> **C5** : `circuit-breaker.ts`, `token-bucket.ts`, `rate-limited-fetch.ts` sont des
> copies quasi-identiques de `packages/core/src/polymarket/` (aussi dans
> `@polywatch/copy-trading`). `api-client.ts` est **spécifique** au worker
> (surface riche) — ne pas centraliser avec le client minimal core.

| Fichier | Rôle |
|---|---|
| `websocket-book.ts` | Carnet en mémoire ; reconnexion backoff ; fallback REST si WS injoignable au boot |
| `websocket-user.ts` | Canal user authentifié ; réconciliation `placing` à la reconnexion. Timeout de connexion `WS_CONNECT_TIMEOUT_MS` + rejet si `close`/`error` avant `open` (aligné sur `websocket-book.ts`) |
| `sync-book-subscriptions.ts` | Resync abonnements book (10 s) + assets pending move (TTL 30 s) |
| `connection-manager.ts` | Hub central des connexions WebSocket et carnets d'ordres ; importé par 20+ fichiers |
| `book-error-log.ts` | Filtre les `log.warn` CLOB book **404** selon `system_config` `worker.log.book_404_errors` (défaut `false`) ; les autres erreurs book restent toujours loguées |
| `circuit-breaker.ts` / `token-bucket.ts` / `rate-limited-fetch.ts` | Résilience / rate-limit (**shims** → `@polywatch/core`) |
| `book-freshness.ts` / `ensure-book-ready.ts` | Fraîcheur book + gate avant entry |

### Politique book stale — SL/TP

- **Entry** (copy / crypto / weather BUY) : fail-closed ~15 s (`stale_book` / `ALGO_BOOK_FRESH_MS`) — `WEATHER_OPEN` est dans le même set que `ALGO_OPEN`.
- **SL/TP / exits worker** : **fail-closed** à 30 s (`BOOK_FRESHNESS_WARN_MAX_AGE_MS` dans `constants.ts`) — si `bookUpdatedAt` est plus vieux que le seuil, `evaluateCloseLogic` logue et **retourne sans émettre de close** (`position-exit-evaluator`). Pas d'enregistrement `exit-attempt` pour ce skip.
- **`lastTradePrice` stale** : warn-only (comportement inchangé).

## Watchdogs

| Composant | Cadence | Rôle |
|---|---|---|
| `closing-watchdog.ts` | 15 s | `closing` > 3 min → `failActiveForPosition` puis `markFailed` |
| `pending-entry-janitor.ts` | 30 s | Reprise algo : ré-enqueue BUY si `pending` + réservation active **sans** ligne `executions` BUY (logicalKey `janitor:{positionId}`) |
| `placing-janitor.ts` | 15 s (défaut seed) | **Sim-only** — finalize orphelins `placing` via `ExecutionService.loadOrphanPlacingSim` (+ cooldown ALGO_OPEN BUY) |
| `sim-realism-janitor.ts` | 1 h | Purge `clob_latency_samples` / `shadow_fills` |
| `executor.ts` | N/A | `settleTerminal` (sim+real) ; `finally` force-failed **sim-only** |
| `reservation-janitor.ts` | 60 s | Réservations expirées → `pending` cancelled |

## File Redis (`queue/redis-queue.ts`)

- `enqueue` = `RPUSH` ; consommation = `BRPOPLPUSH file file:processing` (at-least-once).
- Ack = `LREM` ; échec répété → dead-letter (`file:dead`), rejouable via `/api/internal/queues/:name/replay-dead`.
- `recoverOrphans()` au démarrage.

## Notifications (`notify/backend-notify.ts`)

POST authentifiés (`x-service-token`) : exécutions, pnl-ticks, move-detected, alertes, **circuit-breaker** (seul push métrique actif).

`clob/notify-alert.ts` (`notifyBackendAlert`) est **fire-and-forget synchrone** : il délègue à `postBackendAlert` (qui avale les erreurs fetch) sans `await`, donc une alerte lente ne bloque jamais la boucle stratégie ni l'émetteur (DLQ, exit evaluator, etc.).

## Cadences (`constants.ts`)

Toutes les constantes sont des `export let` initialisées depuis `WORKER_CONFIG_DEFAULTS` puis **réassignées** par `syncNamedExportsFromWorkerConfig()` à la fin de `initWorkerConfigCache()` (lecture des overrides `worker.*` en DB). Les live bindings ESM propagent les valeurs DB vers tous les importeurs — ne pas reconvertir en `export const` sous peine de rendre les overrides inopérants.

| Constante | Valeur | Composant |
|---|---|---|
| `STRATEGY_EVAL_INTERVAL_MS` | 100 ms | StrategyProcessing |
| `MARKET_RESOLUTION_LOOP_MS` | **15 s** | MarketResolutionWatcher |
| `REDEMPTION_LOOP_MS` | 15 s | RedemptionHandler |
| `CLOSING_WATCHDOG_LOOP_MS` | 15 s | ClosingWatchdog |
| `BOOK_SUBSCRIPTION_SYNC_MS` | 10 s | syncBookSubscriptions |
| `PLACING_JANITOR_LOOP_MS` | 15 s (défaut seed ; configurable `worker.placing_janitor.loop_ms`) | PlacingJanitor |
| `RESERVATION_JANITOR_LOOP_MS` | 60 s | ReservationJanitor |

> L'intervalle MoveDetector (`CopyConfig.moveDetectorIntervalMs`, défaut 2 s) est
> géré par `@polywatch/copy-trading`, pas par le worker.

## Shutdown (`SIGTERM` / `SIGINT`)

Le handler `shutdown()` (async) exécute l'arrêt ordonné :

1. `clearTimeout` des 3 debounce timers (`algoSelectionsSyncTimer`, `backendReadyDebounceTimer`, `marketResolvedDebounce`).
2. `clearInterval` des timers périodiques (`subscriptionTimer`, `openPositionRefreshTimer`, `marketTickPurgeTimer`, `marketPriceTickPurgeTimer`, …).
3. `stop()` sur `marketPriceHistorySyncer` (plus de MoveDetector côté worker).
4. Déconnexion WebSockets (`wsClient.disconnect()`, `userChannel.disconnect()`).
5. `quit()` des connexions Redis (cmd, pub, sub, consumers d'exécution).
6. `ds.destroy()` (DataSource PostgreSQL).
7. `process.exit(0)`.

**Note** : les boucles watchdog internes (`strategy.startEvaluation`, `marketResolutionWatcher.startLoop`, `redemption.startLoop`, `closingWatchdog.start`, `placingJanitor.start`, `reservationJanitor.start`, `pendingEntryJanitor.start`, `simRealismJanitor.start`) ne sont pas explicitement stoppées avant `ds.destroy()` — elles peuvent tirer une dernière fois sur un pool fermé, mais `safeInterval` et les `try/catch` internes absorbent les rejections (log error, pas crash). Une amélioration future serait d'exposer un `stop()` sur chaque watchdog.

**Caveat connu** : un crash de consumer Redis pendant le shutdown (connexion fermée par `quit()`) peut déclencher `process.exit(1)` qui interrompt le cleanup gracieux. Copy-trading utilise déjà un flag `shuttingDown` pour inhiber ce `exit(1)` ; le worker peut suivre le même pattern.
