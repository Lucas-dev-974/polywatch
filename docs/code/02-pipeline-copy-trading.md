# Pipeline de copy trading

Vue bout-en-bout du chemin chaud, avec les fichiers sources impliqués à chaque étape.

> Correctifs pipelines audit subagents (2026-07-05) :
> [`audits/2026-07-05_correction-pipelines-audit-p0.md`](../audits/2026-07-05_correction-pipelines-audit-p0.md)
>
> Correctifs pipelines position (2026-06-21) :
> [`audits/2026-06-21_correction-bugs-pipelines-position.md`](../audits/2026-06-21_correction-bugs-pipelines-position.md)
>
> Correctif sorties forcées illiquides (2026-06-29) :
> `lastTradePrice` est utilisé pour (1) déclencher le SL/TP/trailing quand le
> carnet est figé, (2) placer l'ordre FAK à un prix exécutable, et (3) alimenter
> le retry automatique des sorties forcées (SL, trailing, pre-close loss,
> kill-switch). TP exclu du retry automatique.

## 1. Détection des mouvements (`@polywatch/copy-trading`)

```
Data API Polymarket (REST, positions par trader, sizeThreshold=0)
   │  polling adaptatif par trader (packages/copy-trading/src/processors/move-detector.ts)
   │  retour { positions, truncated } — skip faux CLOSED si troncature
   ▼
PollCycleService.runPollCycle()              core/services/poll-cycle.service.ts
   │  diff snapshot entrant vs TraderSnapshot en base
   │  transitions : OPENED / INCREASED / DECREASED / CLOSED
   │  idempotence : hashMoveEventId(trader::condition::asset::type::sizes::seq)
   │  filtrage pertinence : OPENED toujours, autres seulement si
   │  une CopiedPosition 'open' existe (move-events/relevance.ts)
   ▼
INSERT MoveEventEntity (UNIQUE sur le hash, conflit = skip idempotent)
   ▼
RedisQueue('move-events').enqueue()  +  notification backend (move_detected)
```

- Premier poll d'un trader nouvellement ajouté = `reconcile` + `firstPollPending`.
  Si le poll est **tronqué**, la baseline n'est **pas** écrite et le flag reste
  actif jusqu'à un poll complet (`!truncated`). Traders déjà connus en base :
  `runPollCycle` direct (pas de reconcile).
- `pollAll` ne poll que les adresses Ethereum valides (`isPollableTraderAddress`) ;
  les sentinelles watchlist `crypto-algo` / `weather-algo` sont skippées (pas
  d'appel Data API).
- `TraderSnapshotSeq` fournit un numéro de séquence monotone par trader, inclus dans le hash.

## 2. Décision de copie (module `copy/` dans `@polywatch/copy-trading`)

`packages/copy-trading/src/processors/copy-processor.ts` consomme `move-events` et délègue à :

| Fichier | Rôle |
|---|---|
| `copy/copy-risk-gate.ts` | Kill switch, filtres mouvement, whitelist tags |
| `copy/copy-entry-pipeline.ts` | Entrées complètes (filtres → réservation → BUY) |
| `copy/copy-exit-pipeline.ts` | Sorties (qty proportionnelle, gate MOS, SELL) |

**Entrées (OPENED / INCREASED)**
1. Vérifications : kill switch non déclenché, `isCopyMoveAllowed`, `isIncreaseAllowed`, trader actif. Trader absent → `markProcessed` immédiat.
2. **Filtre type de marché** (`passesMarketTagFilter`) : si `simAllowedMarketTags` / `realAllowedMarketTags` est non vide, `MarketService.resolveTagSlugs(conditionId)` puis `isMarketTagAllowed` + `getCopyAllowedMarketTags` (`CopyConfig`). Skip si aucun slug en commun. Les sorties ne passent pas par ce filtre.
3. **Filtre minTimeToClose** (`copy-entry-pipeline.ts` — `getCopyMinTimeToClose(copyConfig, mode)`) : si le temps restant avant la clôture du marché (`timeToEndMs`) est inférieur ou égal à `minTimeToClose * 1000`, l'entrée est refusée. Empêche les copies trop proches de la résolution du marché.
4. **Filtre proximité SL** (augmentations uniquement, `copy-risk-gate.ts` — `evaluateCopyIncreaseSlProximity()`) : si `copyIncreaseSlProximityEnabled`, l'augmentation est refusée quand le PnL de clôture a déjà atteint `copyIncreaseSlProximityPercent` de la distance SL. Configurable par mode via `getModeCopyIncreaseSlProximityPercent(risk, mode)`.
5. Sizing (`core/src/sizing/` + `copy-trading/src/sizing/`) : proportionnel au portefeuille du trader (`resolve-trader-portfolio.ts`), plafonné par `maxPositionSizeUsdc` ; solde réel via `fetchAvailableRealCash()` (backend `/api/internal/balances?mode=real` ou `realCashOverride`, **moins** réservations actives et BUY in-flight sans réservation). Cash indisponible → skip `'Cash réel indisponible'` (pas de retry DLQ).
6. **Triple-pass VWAP** (`pricing/vwap.ts`) : passe 1 sur qty=1 pour estimer le prix ; passe 2 avec la quantité estimée ; passe 3 avec la **quantité finale** pour obtenir bid+ask exécutables et appliquer le filtre de liquidité.
7. **Filtre bid/ask** : `isEntryBidAskRatioAcceptable(bidVwap, askVwap, getCopyMinBidToAskRatio(copyConfig, mode))` — skip si le bid exécutable est trop bas par rapport à l'ask (spread extrême). Seuil par mode dans `copy_config` (`*MinBidToAskRatio`, défaut `0.9`, `0` = off). Avant ce filtre : gate MOS (`applyEntryMosGate`) + depth retry ask (`fetchEntryAskLiquidityWithRetries`).
8. **Filtre momentum** (`copy-entry-pipeline.ts` — `applyMomentumGate()`) : si `momentumFilterEnabled` est activé pour le mode, l'entrée est refusée lorsque le `entryAskVwap` est inférieur au prix moyen du trader (`traderAvgPrice`). Bloque les copies de positions déjà sous l'eau. Fail-open si le prix moyen est indisponible.
9. **Signal score sizing** (`copy-entry-pipeline.ts` — `computeEntrySignalScore()`) : si `signalScoreSizingEnabled`, un score de confiance du signal (0..1) est calculé à partir du momentum, du spread et de la liquidité. Un multiplicateur est appliqué à la taille d'entrée. L'entrée est refusée si le score < 0.2.
10. `ReservationService.reserve()` (transaction) : contrôles max positions / max taille / max exposition via `EntityManager` ; garde **COPY_OPEN** anti-doublon ; création d'une `CopiedPosition` en statut `pending` + d'une `PositionReservation` (TTL 180 s).
11. Enqueue d'un `OrderSignal` BUY sur `order-signals` (hash `hashCopyOrderSignalId`).
12. **Reprise** : si une réservation existe déjà pour le même signal (enqueue Redis
    échoué), `resumeEntryFromReservation` (`core/sizing/`) ré-enfile sans refiltrer ;
    skip permanent → libération réservation.

**Modes** : `resolveCopyModesWithReasons` (`copy-risk-gate.ts`) — `sim` si
`simEnabled`, `real` si `realEnabled && realTradingEnabled`. Chaque mode est
traité dans son propre `try/catch` dans `copy-processor.ts` : une erreur sur un
mode est loguée et enregistrée comme skip `process_mode_error` sans bloquer
l'autre mode.

**Sorties (DECREASED / CLOSED)**
1. Recherche de la position copiée `open` correspondante (`copy-position-lookup.ts`).
2. `computeSellQuantity()` : vente proportionnelle à la réduction du trader (totale si CLOSED).
3. **Gate MOS** : pour `DECREASED`, skip si `sellQty < resolveMinOrderShares()` (sortie partielle sous le minimum marché ; MOS public).
4. Enqueue d'un `OrderSignal` SELL sur `order-signals` (pas `close-signals`).

## 3. Exécution (executor)

Deux instances de `worker/src/processors/executor.ts` :
- **executorA** ← `order-signals` (entrées + exits copy)
- **executorB** ← `close-signals` (SL/TP/trailing/pre-close/kill switch/manuel)

```
positionLocks.runSequentially(copiedPositionId, async (signal) => {  // timeout 60 s
  si lock expiré → pas d'enqueue result ; AbortSignal propagé aux appels CLOB
  si fermeture totale → CopiedPositionService.beginClose()   // open → closing, closingAttemptSeq++
  si SELL et qty < mos  → revertClose() ; return               // attente résolution
  claimResult = ExecutionService.claim()                       // { execution, alreadyInFlight }
  si alreadyInFlight (real) → reconcileInFlightToResult()      // getOrder/getTrades, pas de repost
  sinon mode real       → RealExecutor.execute()               // CLOB FAK (timeout 30 s)
  sinon                 → simulateFill()                       // VWAP du book + frais taker
                                                              // fallback lastTradePrice si book absent (SELL only)
  si result non null   → resultsQueue.enqueue(ExecutionResult)
})
```

**simulateFill** (`worker/src/processors/executor.ts`) :
- Fill au VWAP du book (bid pour SELL, ask pour BUY), frais taker, slippage guard.
- **Fallback lastTradePrice** : si le book est absent (`null`) ou sans bid
  (`fillPrice ≤ 0`), tente un fill au `lastTradePrice` (du signal ou du
  metrics cache). Limité aux SELL, vérifie la fraîcheur
  (`LAST_TRADE_PRICE_MAX_AGE_MS`), applique le slippage guard pour les raisons
  guarded (TP, `PRE_CLOSE_WIN`), le min order size et le hold-if-winning.

**RealExecutor** (`worker/src/clob/real-executor.ts`) :
1. `loadTradingContext()` — ClobClient POLY_1271 + deposit wallet (cache 30 min).
2. Prix exécutable depuis le carnet en mémoire ; **slippage guard** pour les raisons gardées.
3. `roundToTick()` selon le tick size du marché (cache 5 min).
4. Min order **SELL** : `resolveMinOrderShares()` (`getClobMarketInfo().mos` → book `min_order_size`).
5. **Sorties forcées / carnet figé** : si le `OrderSignal` `SELL` porte un
   `lastTradePrice` inférieur au `executableBidVwap` affiché, le prix limite
   FAK devient `min(executableBidVwap, lastTradePrice)` arrondi au tick. L'ordre
   est alors très probablement exécutable au dernier prix marché connu, au lieu
   de rester non matché contre un bid fantôme.
6. `createAndPostMarketOrder()` (FAK, timeout 30 s) ; `clobOrderId` enregistré immédiatement.
7. `parseFillResponse()` — BUY/SELL sémantique CLOB ; `delayed` → return null (reste `placing`).
8. Frais : `resolvePlatformFeeParams` + formule taker (`pricing/fees.ts`).

**Réconciliation** (`execution-reconciler.ts`, `startup-reconciler.ts`) :
- Au boot, reconnexion WS user, retry executor : `getOrder` puis `getTrades` ;
- Exec réconciliables : `placing`, `partial`, `failed` récent avec `clobOrderId`.

## 4. Finalisation (results-consumer + execution.service)

`completeExecution()` (`worker/src/clob/execution-completion.ts`) sous **`positionLocks`**
(results-consumer **et** user-channel-handler) → `ExecutionService.finalize()` (transaction) :

| Cas | Effet |
|---|---|
| BUY initial filled | position `pending → open`, `quantity`, `entryPrice`, `entryBidVwap` |
| BUY increase | moyenne pondérée du `entryPrice`, `quantity += delta` |
| SELL | `realizedPnl`, décrément qty ; `fillQuantity` plafonné à `requestedQty` ; si reliquat < min → `closed`, sinon si `closing` → retour à `open` |
| Fill tardif (real) | accepte fill même si exec était `failed` (sans fill préalable) |
| Échec/aucun fill | Execution `failed`, position restaurée si BUY pending ou SELL closing |
| Mode sim | ajustement `SimulationBalance` (`simulation/accounting.ts`) |

Fills partiels : VWAP pondéré entre appels `finalize`. Canal WS user : **order UPDATE**
prioritaire (`size_matched` cumulatif − déjà fillé) ; events `trade` ignorés tant
que l'exec est in-flight.

**Retry des sorties forcées** (`results-consumer.ts`) : une exécution `SELL`
stratégique (`SL`, `TRAILING`, `PRE_CLOSE_LOSS`, `PRE_CLOSE_WIN`, `KILL_SWITCH`) qui échoue avec
`no_liquidity`, `order_not_matched` ou `tick_size_fetch_failed` est
automatiquement retentée (jusqu'à `slCloseMaxRetries` par mode) tant que la
position reste `open`. La décision lit `execution.reason` (ligne DB), pas le cast
`OrderSignal` du job. `failedExecution` propage `reason` et `closeRetryAttempt`.
Le signal de retry embarque le `lastTradePrice` connu.
Le TP n'est **pas** inclus dans ce retry automatique.

## 5. Stratégie SL/TP/trailing (strategy-processing)

Boucle 100 ms + déclenchement sur chaque mise à jour du carnet (`setOnBookUpdate`).
Évaluation déléguée à `strategy/position-exit-evaluator.ts` ; kill switch à
`strategy/kill-switch-monitor.ts`.

```
pour chaque CopiedPosition 'open' :
  bidVwap exécutable (carnet en mémoire)
  triggerPnl% = (bidVwap − entryBidVwap)/entryBidVwap        ← déclencheurs
  displayPnl% = (bidVwap − entryPrice)/entryPrice            ← affichage
  peakClosurePnl% persisté même si illiquide (position-branches.ts)
  updatePnlFields() (DB) + pnl_tick (WebSocket via backend)
  evaluateSlTpTrailing()  : SL → TP → TRAILING (armé si peak ≥ activation)
                            Évaluation hybride : trigger vs bid d'entrée,
                            closure vs prix d'entrée + frais.
                            En illiquide, fallback sur `lastTradePrice` si celui-ci
                            est plus défavorable (évite un SL qui ne se déclenche pas
                            simplement parce que le bid affiché est un niveau figé).
  evaluatePreCloseExit()  : fenêtre pre-close — holdIfWinning si PnL vente ≥ 0 USDC ;
                            PRE_CLOSE_LOSS (jamais PRE_CLOSE_WIN) ; annulé si illiquide
  → buildCloseOrderSignal() (FAK, hash sur closingAttemptSeq, lastTradePrice embarqué)
    → close-signals
```

**Kill switch** (réévalué ≥ toutes les 10 s) : si `|PnL réalisé du jour| ≥ maxDailyLossUsdc` → blocage des nouvelles copies + selon config `force_close_all` (`closingAttemptSeq + 1` sur chaque signal).

## 6. Résolution de marché & rédemption

- `MarketResolutionService` (**15 s**) : repolling Gamma→CLOB ; positions `open/closing/failed` → `pending_resolution` quand settled.
- `redemption-handler.ts` (15 s) : `pending_resolution` **et `failed`** (qty > 0). Gate `isMarketRedeemable` avant redeem. `claimUnlessFilled` → `false` si `REDEMPTION` déjà en vol (timeout placing 5 min côté core).
  - **sim** : crédit cash direct (payoff 0/1).
  - **real** : POST `/api/internal/redeem` avec **`assetId`** → CTF on-chain (collatéral détecté dynamiquement). `no_ctf_balance` → clôture sans tx ; `zero_payout` → `failed` + retry.

## 7. Filets de sécurité

| Mécanisme | Fichier | Rôle |
|---|---|---|
| Startup reconciler | `startup-reconciler.ts` + `execution-reconciler.ts` | Exec réelles `placing`/`partial`/`failed`+clobOrderId → finalize ou failed |
| Recover orphans | `redis-queue.ts` | Jobs `:processing` abandonnés |
| Closing watchdog | `closing-watchdog.ts` | `closing` > 3 min → fail exec actives puis `markFailed` (15 s) |
| Placing janitor | `placing-janitor.ts` | **Sim-only** : placing orphelines → `finalize` failed / `placing_orphan` (15 s défaut). BUY `pending` + exec `placing` stale via réservation (> 60 s). Réel : reconcile REST/WS |
| Pending entry janitor | `pending-entry-janitor.ts` | Algo : ré-enqueue si réservation sans exec BUY (30 s) |
| Reservation janitor | `reservation-janitor.ts` | Réservations expirées → `pending` cancelled (60 s) |
| Dead-letter queues | `worker-queues.ts` | Replay via `/api/internal/queues/:name/replay-dead` |
| config-changed | `index.ts` | Rechargement CLOB, abonnements WS, kill switch |
