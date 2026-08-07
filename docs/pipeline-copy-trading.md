# Pipeline de copy-trading

Ce document décrit le parcours complet d'un mouvement de trader, depuis sa
détection jusqu'à la clôture de la position copiée. La **détection et les pipelines
copy** (MoveDetector, CopyProcessor) vivent dans `@polywatch/copy-trading`
(`packages/copy-trading/src`). L'**exécution** (Executor, sorties SL/TP) reste
dans `@polywatch/worker`, avec la logique métier partagée dans `@polywatch/core`.

> Voir aussi [`code/05-copy-trading.md`](code/05-copy-trading.md) et
> [`code/01-architecture.md`](code/01-architecture.md) pour la topologie à 3 services.

> Correctifs pipelines audit subagents (2026-07-05) :
> [`audits/2026-07-05_correction-pipelines-audit-p0.md`](./audits/2026-07-05_correction-pipelines-audit-p0.md)
>
> Correctifs pipelines position (2026-06-21) :
> [`audits/2026-06-21_correction-bugs-pipelines-position.md`](./audits/2026-06-21_correction-bugs-pipelines-position.md)
>
> Correctif sorties forcées sur carnet illiquide (2026-06-29) :
> le worker utilise désormais le **dernier prix trade connu** (`last_trade_price`)
> à la fois pour déclencher le SL/TP/trailing/kill-switch quand le carnet est figé,
> et pour placer l'ordre FAK de sortie à un prix réellement exécutable. Le retry
> automatique est étendu aux sorties forcées (SL, trailing, pre-close loss,
> kill-switch), mais pas au TP.

## Vue d'ensemble

```
                          ┌─────────────────────────────────────────────────────────┐
 Polymarket Data API      │  copy-trading          │         worker               │
        │ positions       │                        │                              │
        ▼                 │ ┌────────────┐  order  │ ┌──────────┐ result          │
 ┌──────────────┐  moves  │ │CopyProcessor│ ──────►│ │ Executor │ ──────►       │ ResultsConsumer
 │ MoveDetector │ ───────►│ │             │  Redis │ │ (FAK)    │ Redis         │   └─► finalize position
 │ (poll 2s)    │ internal│ └────────────┘ order-  │ └──────────┘ exec-          │       └─► POST /api/executions
 └──────────────┘ move-   │       ▲         signals│                results      │           (WebSocket)
                  events  │       │ reserve       │ ┌────────────┐              │
                          │       │ (limites)     │ │StrategyProc│ close-signals│
                          │                        │ │ (~100ms)   │ ► Executor B  │
                          └─────────────────────────────────────────────────────────┘
```

## Étape 1 — Détection des mouvements (`MoveDetector`)

`packages/copy-trading/src/processors/move-detector.ts`

- Polling de la watchlist toutes les **2 000 ms** (`startPolling`).
- Pour chaque trader actif (`active`, `simEnabled` ou `realEnabled`), récupère
  ses positions via l'API Data Polymarket (`fetchTraderPositions`).
- Premier passage → `PollCycleService.reconcile` (établit une *baseline* sans
  émettre de mouvements). Passages suivants → `runPollCycle`.
- Les mouvements détectés sont poussés dans la file Redis `move-events`.

### Calcul des transitions (`PollCycleService`)

`packages/core/src/services/poll-cycle.service.ts`

Compare le snapshot précédent (table `trader_snapshots`) au snapshot entrant et
en déduit des transitions :

| Condition | Type de mouvement |
|-----------|-------------------|
| Position absente avant, présente maintenant | `OPENED` |
| `size` entrante > précédente | `INCREASED` |
| `size` entrante < précédente | `DECREASED` |
| Position disparue ou `size = 0` | `CLOSED` |

Points clés :
- **Idempotence** : chaque mouvement reçoit un id déterministe
  (`hashMoveEventId` sur trader/condition/asset/type/tailles/seq). Les conflits
  `UNIQUE` sont ignorés silencieusement.
- Un compteur de séquence par trader (`TraderSnapshotSeq`) versionne les cycles.
- `DECREASED` / `CLOSED` ne sont persistés que si une position copiée ouverte
  existe (`requiresOpenCopiedPosition`).
- **Pagination Data API** : `sizeThreshold=0`, limite 500/page, offset max 10 000.
  Si troncature détectée, les positions absentes du snapshot ne génèrent **pas**
  de faux `CLOSED` (`snapshotTruncated` dans `PollCycleService`).
- **Sentinelles algo** : `MoveDetector.pollAll` filtre via
  `isPollableTraderAddress` — seules les adresses `0x…` (40 hex) sont pollées.
  Les entrées `crypto-algo` / `weather-algo` (rattachement UI/positions) ne
  déclenchent pas d'appel `/positions` (évite HTTP 400 et pollution du circuit
  breaker Data API).
- **Reconcile boot** : `firstPollPending` pour les traders nouvellement ajoutés à
  la watchlist. Tant que le premier poll est **tronqué**, le flag reste actif et
  la baseline (`upsertBaseline`) n'est **pas** écrite — évite une baseline
  incomplète qui provoquerait des faux `OPENED` au poll suivant. Le flag n'est
  effacé qu'après un premier poll **complet** (`!truncated`).
- `recoverOrphanMoves` réinjecte au démarrage les mouvements non traités.

## Étape 2 — Décision de copie (`CopyProcessor` + module `copy/`)

Orchestration dans `packages/copy-trading/src/processors/copy-processor.ts` ;
logique métier dans `packages/copy-trading/src/processors/copy/` :

| Fichier | Rôle |
|---------|------|
| `copy-processor.ts` | Consomme `move-events`, résout modes, délègue |
| `copy-risk-gate.ts` | Kill switch, filtres type mouvement, whitelist tags |
| `copy-entry-pipeline.ts` | Entrées : filtres, VWAP, sizing, réservation, BUY |
| `copy-exit-pipeline.ts` | Sorties : lookup position, qty proportionnelle, SELL `enqueueUnique` |
| `copy-position-lookup.ts` | Recherche position ouverte |

Consomme `move-events`. Pour chaque mouvement :

1. Retrouve l'entrée de watchlist correspondante. Si le trader est absent,
   le mouvement est marqué `processed` avec raison explicite (évite les retries
   infinis).
2. Détermine les **modes** à appliquer (`resolveCopyModesWithReasons`) :
   - `sim` si `entry.simEnabled`.
   - `real` si `entry.realEnabled` **et** `risk.realTradingEnabled`.
   Chaque mode est traité dans son propre `try/catch` : une erreur sur un mode
   est loguée et enregistrée comme skip `process_mode_error` sans bloquer
   l'autre mode. Si **au moins un** mode throw, le move **n'est pas**
   `markProcessed` — la queue Redis retente le job (idempotent par mode via
   `hashCopyOrderSignalId` + reprise réservation).
3. Filtres : entrées ignorées si `!entry.active` ; type filtré par
   `isCopyMoveAllowed` (`copyIncreaseEnabled` / `copyDecreaseEnabled`) ;
   kill switch (`shouldBlockEntry`).
4. **Filtre par type de marché** (entrées uniquement) : si la whitelist du mode
   (`simAllowedMarketTags` / `realAllowedMarketTags`) est non vide, résolution des
   tags Gamma du marché (`MarketService.resolveTagSlugs`) puis vérification via
   `isMarketTagAllowed` + `getCopyAllowedMarketTags`. Les sorties (`DECREASED` / `CLOSED`) ne sont
   **jamais** filtrées.
5. **Filtre bid/ask** (entrées uniquement, dans `copy-entry-pipeline.ts`) : bid et ask VWAP
   pour la quantité cible finale ; refus si
   `bidVwap / askVwap < minBidToAskRatio` du mode (`isEntryBidAskRatioAcceptable`,
   défaut `0.9`, `0` = off).
6. **Filtre momentum** (entrées uniquement) : si `momentumFilterEnabled` est activé
   pour le mode, l'entrée est refusée lorsque le `entryAskVwap` est inférieur au
   prix moyen du trader (`traderAvgPrice`). Ce filtre bloque les copies de
   positions déjà sous l'eau. Fail-open si le prix moyen est indisponible.
7. **Signal score sizing** : si `signalScoreSizingEnabled`, un score de qualité
   du signal est calculé (`computeEntrySignalScore`) et un multiplicateur est
   appliqué à la taille d'entrée. L'entrée est refusée si le score est < 0.2.
8. **Entrée** (`OPENED` / `INCREASED`) → `runCopyEntryPipeline`.
   **Sortie** (`DECREASED` / `CLOSED`) → `runCopyExitPipeline`.
9. Marque le mouvement comme traité (`markProcessed`).

### Filtre par type de marché

Configuration indépendante par mode dans `copy_config` (`CopyConfig`) :
- `simAllowedMarketTags` — simulation
- `realAllowedMarketTags` — réel

Stockées en JSON (`'[]'` par défaut). Exposées via `GET/PUT /api/config/copy`.
Modifiables dans l'UI : **Configurer** → onglet **Entrée** (pages Simulation et Réel).

| Whitelist | Comportement |
|-----------|--------------|
| `[]` (vide) | Tous les marchés sont copiés (rétrocompatible) |
| Non vide | Le marché doit partager **au moins un slug** avec la liste |
| Marché sans tags résolus + whitelist active | Entrée bloquée (fail-closed) |

**Résolution des tags** (`packages/core/src/market/tags.ts`,
`packages/core/src/polymarket/market-metadata.ts`) :

1. Lecture du cache PostgreSQL `markets.tag_slugs` si déjà peuplé.
2. Sinon `GET /markets?condition_ids=…` (Gamma), puis enrichissement via
   `GET /events?slug=…` — la réponse `/markets` n'inclut pas les tableaux `tags`.
3. Agrégation : `category` normalisée + `tags[].slug` + tags des `events[]`
   liés (`parseTagSlugsFromGammaRaw`).

Le catalogue UI des catégories principales est servi par `GET /api/market-tags`
(slugs nav fixes + recherche optionnelle sur l'index Gamma complet).

### Filtre bid/ask à l'entrée

Configuration par mode : `simMinBidToAskRatio`, `realMinBidToAskRatio` (défaut
`0.9`, `0` = désactivé). Appliqué dans `copy-entry-pipeline.ts` après le calcul de la
quantité cible :

| Condition | Comportement |
|-----------|--------------|
| `minBidToAskRatio = 0` | Pas de filtre (rétrocompatible) |
| `bidVwap <= 0` ou `askVwap <= 0` | Entrée refusée |
| `bidVwap / askVwap < seuil` | Entrée refusée (log worker) |
| Ratio ≥ seuil | Copie autorisée (réservation + ordre) |

Motivation : un spread extrême (ex. achat à 0,99, bid à 0,01) produit une forte
perte « clôture » dès l'ouverture alors que le SL (basé sur le mouvement du bid)
ne se déclenche pas. Voir aussi [`configuration.md`](./configuration.md#filtre-bidask-à-lentrée-minbidtoaskratio).

### Entrée (`copy-entry-pipeline.ts`)

- `canHandleEntry` : refuse un `OPENED` si une position active existe déjà ;
  pour `INCREASED`, vérifie `isIncreaseAllowed` (limite
  `maxIncreasesPerPosition`).
- **Filtre proximité SL** (augmentations uniquement) : si
  `copyIncreaseSlProximityEnabled`, l'augmentation est refusée quand le PnL
  de clôture a déjà atteint `copyIncreaseSlProximityPercent` de la distance SL.
  Ex: SL=-100%, proximity=80% → blocage si `closurePnlPercent <= -80%`.
- **Triple-pass VWAP** :
  1. Passe 1 : qty = 1 pour estimer le prix ask (rough).
  2. Passe 2 : VWAP ask avec la quantité estimée → recalcul de la qty cible
     (`computeEntryTargetQuantity`).
  3. Passe 3 : bid **et** ask VWAP pour la **quantité finale** → filtre
     bid/ask + prix utilisés pour la réservation et le signal.
- **Filtre bid/ask** (`core/src/risk/policy.ts`) : si
  `bidVwap / askVwap < getCopyMinBidToAskRatio(copyConfig, mode)`, l'entrée est
  abandonnée. Protège contre les carnets où l'achat à l'ask laisse une perte
  économique immédiate au bid (spread extrême) non couverte par le SL — voir
  [Configuration — filtre bid/ask](./configuration.md#filtre-bidask-à-lentrée-minbidtoaskratio).
- **Réservation** (`ReservationService.reserve`) : applique les limites de risque
  dans une transaction atomique (comptages via le `EntityManager` de la
  transaction, pas de cache incohérent). Garde **COPY_OPEN** : refuse si une
  position active existe déjà sur `(watchlist, condition, asset, mode)`.
- **Sizing réel** : `fetchAvailableRealCash()` (`packages/copy-trading/src/sizing/real-cash.ts`)
  = solde via backend `/api/internal/balances?mode=real` (ou `realCashOverride`) −
  réservations actives − notionnel BUY en vol sans réservation. Cash indisponible
  → skip `'Cash réel indisponible'` (move processed, pas de DLQ). MOS entry via
  API CLOB publique uniquement.
- Émet un `OrderSignal` `BUY` de type `FAK` dans la file `order-signals`.
- **Reprise après échec transitoire** : si une réservation existe déjà pour le
  même `orderSignalId` (enqueue Redis échoué après `reserve`), le pipeline
  ré-enfile l'ordre via `resumeEntryFromReservation` (`@polywatch/core`) sans
  repasser les filtres d'entrée. Les skips permanents (liquidité, minimums)
  **libèrent** la réservation pour ne pas bloquer l'exposition jusqu'au janitor.

### Sortie (`copy-exit-pipeline.ts`)

- Retrouve la position ouverte ; calcule la quantité à vendre
  (`computeSellQuantity`) au prorata de la réduction du trader.
- **Gate MOS sur baisse partielle** : pour `DECREASED`, si `sellQty <
  resolveMinOrderShares()` (minimum marché CLOB), la sortie est **ignorée**
  (l'ordre serait rejeté par le CLOB ou échouerait en sim). Les clôtures
  totales (`CLOSED` → `COPY_CLOSE`) passent par l'Executor qui peut
  `revertClose` et attendre la résolution si qty < mos.
- Émet un `OrderSignal` `SELL` (`COPY_DECREASE` ou `COPY_CLOSE`) sur
  **`order-signals`** (pas `close-signals`) via `enqueueUnique` (clé =
  `hashCopyOrderSignalId`, TTL 120 s) — empêche un double enqueue si le
  `CopyProcessor` retente le move après un throw sur l'autre mode.

### Réservation et limites de risque (`ReservationService`)

`packages/core/src/services/reservation.service.ts` — dans une transaction
atomique, rejette l'entrée si :

| Limite | Erreur levée |
|--------|--------------|
| Positions actives ≥ `maxOpenPositions` | `max_open_positions` |
| Notionnel > `maxPositionSizeUsdc` | `max_position_size` |
| Exposition + notionnel > `maxExposureUsdc` | `max_exposure` |

Une `PositionReservation` est créée avec un TTL (`RESERVATION_TTL_MS = 180 s`).
`ReservationJanitor` nettoie les réservations expirées et annule les positions
restées `pending`.

## Étape 3 — Exécution (`Executor`)

`packages/worker/src/processors/executor.ts`

Deux instances tournent : `executorA` consomme `order-signals` (entrées/sorties
copiées), `executorB` consomme `close-signals` (sorties de stratégie).

- **Verrou par position** (`PositionLockRegistry`, timeout **60 s**) : sérialise les signaux **et** les
  finalisations async (`ResultsConsumer`, canal WS user) pour une même position.
  Si le verrou expire (finalisation bloquée), l'exécuteur **n'enfile pas** le
  résultat et propage `AbortSignal` jusqu'aux appels CLOB (`withTimeout`).
  Le `PositionLockRegistry` est un registre en mémoire avec timeout configurable.
  Chaque verrou est identifié par `copiedPositionId`. Les tentatives d'acquisition
  sur une position déjà verrouillée sont rejetées immédiatement (pas de queue d'attente).
  Les verrous sont automatiquement libérés après expiration ou sur appel explicite
  de `release()`. Utilisé par : `Executor`, `ResultsConsumer`, `UserChannelHandler`.
- Pour un signal de clôture totale (`isTotalCloseSignal`) → `beginClose`
  (transition `closing`, rejet si concurrent).
- **Quantité sous le minimum marché (`mos`)** : si `quantity < mos` (via
  `getClobMarketInfo` ou `book.min_order_size`), la clôture est annulée
  (`revertClose`) — la position attend la résolution / redemption plutôt qu'un
  FAK voué à l'échec.
- **Claim** idempotent (`ExecutionService.claim`) → `{ execution, alreadyInFlight }`.
  Si `alreadyInFlight` en mode réel : réconciliation via `getOrder` /
  `getTrades` (`execution-reconciler.ts`), **pas** de repost CLOB.
  `already_claimed` sur un second signal distinct est ignoré.
- Routage selon le mode :
  - `real` + `realTradingEnabled` → `RealExecutor.execute` (FAK CLOB réel).
  - sinon → `simulateFill` (fill au VWAP, garde-fou de slippage
    `maxSlippagePercent`, calcul des frais taker `computeTakerFee`).
- **RealExecutor** : timeout 30 s sur `createAndPostMarketOrder` ; réponse
  `ORDER_DELAYED` → exec reste `placing` (réconciliation WS/REST) ; min order
  **SELL** = `mos` par marché (pas `MIN_ORDER_SHARES` global).
- **Prix limite des sorties forcées sur carnet figé** : si un signal `SELL`
  de sortie stratégique (`SL`, `TRAILING`, `PRE_CLOSE_LOSS`, `KILL_SWITCH`)
  porte un `lastTradePrice` inférieur au bid exécutable affiché, l'ordre FAK est
  passé au prix `min(bidVwap, lastTradePrice)` arrondi au tick. Cela donne à
  l'ordre une chance réelle d'être exécuté immédiatement au dernier prix marché
  connu, plutôt que de rester non matché contre un bid figé.
- **Fallback `lastTradePrice` en mode sim** : quand le book est absent
  (`null`) ou sans bid (`fillPrice ≤ 0`), `simulateFill` tente un fill au
  `lastTradePrice` (du signal ou du metrics cache) avant d'échouer avec
  `no_liquidity`. Le fallback est limité aux signaux `SELL`, vérifie la
  fraîcheur du prix (`LAST_TRADE_PRICE_MAX_AGE_MS`), applique le slippage
  guard pour les raisons guarded (TP, `PRE_CLOSE_WIN`), le min order size et
  le hold-if-winning. Si le fallback réussit, l'exécution est marquée
  `filled` au prix `lastTradePrice`.
- Le résultat (`ExecutionResult`) est poussé dans `execution-results` (sauf
  ordre delayed / timeout → pas de enqueue, exec en `placing`).

## Étape 4 — Finalisation (`ResultsConsumer`)

`packages/worker/src/processors/results-consumer.ts`

- Consomme `execution-results` sous le même verrou `positionLocks` que
  l'exécuteur → `ExecutionService.finalize` met à jour la position copiée
  (statut, quantité, prix d'entrée moyen, frais, PnL réalisé…).
- **Fill tardif** : `finalize` accepte un fill réel même si l'exec était `failed`
  (réconciliation WS/REST). SELL : `fillQuantity` plafonné à `requestedQty`.
- Re-synchronise les souscriptions d'order book (`syncBookSubscriptions`).
- **Retry des sorties forcées** : si une exécution `SELL` de sortie stratégique
  (`SL`, `TRAILING`, `PRE_CLOSE_LOSS`, **`TIME_EXIT`**, `KILL_SWITCH`) échoue avec une erreur
  retentable (`no_liquidity`, `order_not_matched`, `tick_size_fetch_failed`) et
  que la position est toujours `open`, un nouveau signal est enfilé dans
  `close-signals`. La décision de retry lit `execution.reason` (et non le cast
  `OrderSignal` du job) pour identifier les sorties forcées. Les résultats
  `failed` propagent `reason` et `closeRetryAttempt` via `failedExecution`.
  Le retry respecte `slCloseMaxRetries` (configurable par mode) ; le signal de
  retry embarque le dernier `lastTradePrice` connu. Le **TP** ne bénéficie pas de
  ce retry automatique.
- Notifie le backend (`POST /api/executions` avec `x-service-token`) qui
  rediffuse l'exécution via WebSocket.

### Canal WebSocket user (chemin parallèle)

`user-channel-handler.ts` finalise aussi via `completeExecution`, sous
`positionLocks`. Pour les partials, les events **`order` UPDATE** (cumul
`size_matched`) sont **prioritaires** sur les events `trade` tant que l'exec
est in-flight (`placing` / `partial` / `failed` récent).

## Étape 5 — Stratégie de sortie (`StrategyProcessing`)

`packages/worker/src/processors/strategy-processing.ts` — boucle ~**100 ms**
(`startEvaluation`), aussi déclenchée à chaque mise à jour d'order book.
L'évaluation des sorties est déléguée à `position-exit-evaluator.ts` ;
le kill switch à `kill-switch-monitor.ts`.

Pour chaque position `open` :

1. Lit les prix exécutables depuis le book en mémoire
   (`ConnectionManager.getExecutablePrices`). **Si le book est illiquide**
   (`executableBidVwap = 0`, WS déconnecté ou aucun niveau) : seul
   `liquidityStatus` est persisté, **aucun PnL n'est recalculé ni de `PnlTick`
   émis** — l'UI conserve ainsi la dernière valeur connue au lieu de figer un
   mark obsolète. L'évaluation des sorties tourne quand même (SL/TP/trailing
   utilisent les valeurs DB persistées), mais le signal `PRE_CLOSE_LOSS` est
   **bloqué** si le book est illiquide — une vente CLOB serait vouée à l'échec
   (`no_liquidity`). La position reste `open` et sera récupérée par le
   `RedemptionHandler` quand le marché sera settled.
2. Sinon, calcule le prix de mark (`getPositionMarkPrice`) à partir du VWAP bid
   et du cycle de vie du marché.
3. Calcule les PnL : `triggerPnlPercent` (bid vs entrée, sert aux déclencheurs),
   `displayPnlPercent` (frais inclus, pour l'affichage), `peakClosurePnlPercent`
   (monotone pour le trailing ; **persisté même si le book est illiquide**),
   `unrealizedPnl`.
4. Persiste les champs PnL et émet un `PnlTick` (throttlé ~100 ms) poussé au
   backend via `POST /api/internal/pnl-ticks`.
5. **Évaluation des sorties** (throttle 50 ms) :
   - `evaluateSlTpTrailing` — priorité fixe **SL → TP → TRAILING**. Le trailing
     ne s'arme qu'après que le pic ait franchi `trailingActivationPercent`.
   - `evaluatePreCloseExit` — sortie **pré-clôture** : si le marché entre dans la
     fenêtre `preCloseSeconds` avant `endDate` (ou tant que `acceptingOrders`
     reste `true` après `endDate`) :
     - si `preCloseHoldIfWinning` et PnL de vente projeté ≥ 0 USDC : **aucune sortie** — la
       position reste ouverte jusqu'à la résolution ; l'exécuteur bloque aussi un
       `PRE_CLOSE_LOSS` dont le fill serait non négatif ;
     - sinon : `PRE_CLOSE_LOSS` si `trigger < 0` **OU** `closure < 0`.
     **Note** : le code live n'émet jamais `PRE_CLOSE_WIN` — une position gagnante
     dans la fenêtre de pré-clôture est toujours conservée jusqu'à la résolution
     (comportement conservateur, conforme à `preCloseHoldIfWinning`).
     **Liquidity gate** : `PRE_CLOSE_LOSS` est annulé
     si le book est `illiquid` — une vente CLOB échouerait avec `no_liquidity`
     et la position bouclerait en `failed`. La position reste `open` et attend
     la redemption naturelle du marché.
     > **Exception (mode sim)** : si un `lastTradePrice` frais est disponible,
     > `simulateFill` l'utilise comme prix de fallback pour exécuter le sell
     > même sur book vide. Voir [Étape 3](#étape-3--exécution-executor).
     >
     > **Note** : Le SL/TP n'est plus supprimé au simple passage de `endDate`.
     > Tant que le marché n'est pas terminal (`closed && !acceptingOrders`)
     > ou résolu, le SL/TP reste actif. Voir `shouldSuppressSlTp` dans
     > `packages/core/src/positions/redemption-wait.ts`.
   - **`evaluateTimeExit`** (positions crypto-algo uniquement) — sortie forcée
     **HARD** à partir de `timeExitSeconds` avant `endDate` :
     - Gagnante quasi certaine (mark ≥ `confidenceBid` + frais) → **tenir**
       jusqu'à redemption ;
     - Gagnante incertaine, perdante, ou prix non vérifiable → **`TIME_EXIT`**
       (vente obligatoire, `holdIfWinning` ignoré) ;
     - Sous `mos` : gate conservé (sim = réel) → redemption si invendable.
     Config : `cryptoAlgoTimeExit*` dans `CryptoConfig` — voir
     [`crypto-algo.md`](./crypto-algo.md#6-sortie-forcée-hard-exit--time_exit).
6. Si une raison de clôture est trouvée et que le book est liquide → émet un
   signal de clôture dans `close-signals` (`buildCloseOrderSignal`).

Logique de risque détaillée dans `packages/core/src/risk/exit-decision.ts` et
`packages/core/src/risk/policy.ts`.

### Order book temps réel (`PolymarketConnectionManager` / `PolymarketBookWebSocket`)

Les prix exécutables proviennent du **canal `market` du CLOB Polymarket**
(`wss://ws-subscriptions-clob.polymarket.com/ws/market`,
`packages/worker/src/polymarket/websocket-book.ts`) :

- **Souscription** : message `{ assets_ids: [...], type: 'market' }` à
  l'ouverture, puis `{ assets_ids: [...], operation: 'subscribe' }` en
  incrémental. Un snapshot REST initial amorce chaque book.
- **Événements** : `book` (snapshot complet) et `price_change` (deltas par
  niveau ; `size = 0` supprime le niveau). Le canal expose aussi un
  `last_trade_price` par marché.
- **Heartbeat** : trame texte `PING` toutes les **10 s** (exigence Polymarket) ;
  le serveur répond `PONG`.
- Chaque mise à jour est recopiée dans le cache lu par la boucle de stratégie
  (`ConnectionManager`) et déclenche une réévaluation. Un re-sync REST
  périodique (`syncBookSubscriptions`, 10 s) sert de filet si le WS décroche.
- **`lastTradePrice` de secours** : quand le carnet est **illiquide**
  (`executableBidVwap = 0`, niveaux figés ou spread excessif) mais qu'un dernier
  trade réel a déjà franchi le seuil SL/TP/trailing, le worker utilise ce prix
  comme référence conservatrice pour évaluer et déclencher la sortie. Cela évite
  qu'une position reste ouverte simplement parce que le bid affiché est un niveau
  fantôme proche du prix d'entrée.

### Marchés near-end (`refreshMarketsNearEnd`)

Quand `preCloseEnabled`, les marchés proches de leur `endDate` voient leur cycle
de vie (`acceptingOrders` / `closed` / `resolved`) rafraîchi depuis Gamma/CLOB,
throttlé à 15 s par marché pour ne pas saturer l'API sur la boucle 100 ms.

## Étape 6 — Résolution & rachat (watchdogs)

| Composant | Intervalle | Rôle |
|-----------|-----------|------|
| `MarketResolutionWatcher` | **15 s** | Détecte les marchés résolus, bascule les positions en `pending_resolution` |
| `RedemptionHandler` | 15 s | Positions `pending_resolution` **et `failed`** (qty > 0). Gate `isMarketRedeemable` avant redeem. `claimUnlessFilled` retourne `false` si une exec `REDEMPTION` est déjà en vol (`placing`/`partial`) — timeout placing 5 min côté core. Appelle `POST /api/internal/redeem` avec **`assetId`**. Refuse clôture si payout = 0 ; `no_ctf_balance` → `filled` (déjà racheté). Crédite le payoff et clôture. |
| `ClosingWatchdog` | 15 s | Positions `closing` > 3 min : annule d'abord les exec actives (`failActiveForPosition`), puis `markFailed` (UPDATE conditionnel) |
| `PlacingJanitor` | 15 s (défaut seed) | **Sim-only** : exec sim orphelines en `placing` → `failed` / `placing_orphan`. Inclut BUY encore `pending` si réservation absente, expirée ou âgée (> `SIM_BUY_PLACING_STALE_MS` = 60 s). Le réel est réconcilié via REST/WS. |
| `PendingEntryJanitor` | 30 s | Algo : ré-enqueue BUY orphelin (réservation active, aucune exec BUY) — distinct du PlacingJanitor |
| `ReservationJanitor` | 60 s | Nettoie les réservations expirées et annule les `pending` orphelines |

## Backfill & Réconciliation

### `reconcileClosingOnClosedClob`

Logique de réconciliation qui détecte les positions marquées `closing` dont l'ordre
a en réalité déjà été exécuté sur le CLOB (fill confirmé via canal WS user mais non
finalisé). Vérifie le statut réel de l'ordre via l'API CLOB et, si déjà exécuté,
finalise la position sans attendre le prochain cycle normal.

### `backfillClosingStartedAt`

Backfill du timestamp `closingStartedAt` pour les positions passées en `closing`
avant l'ajout de cette colonne. Exécuté au démarrage du worker pour garantir la
cohérence des temps de clôture.

### Exit Blocking

Mécanisme qui bloque les tentatives d'exit sur une position pendant une durée
configurable (`exitBlockedUntil` sur `CopiedPosition`). Utilisé pour :
- Empêcher les sorties concurrentes (ex: SL et PRE_CLOSE simultanés)
- Laisser le temps à une exécution en vol de se finaliser
- Éviter les boucles de retry sur des positions instables

## Cycle de vie d'une position copiée

```
pending ──fill──► open ──┬── SL/TP/TRAILING/PRE_CLOSE ──► closing ──► closed
   │                     │         (qty < mos → revertClose, attente résolution)
   │ (réservation        ├── marché résolu ──► pending_resolution ──► closed (REDEMPTION)
   │  expirée / échec)   │
   ▼                     └── pre-close illiquid ──► no_liquidity / order_not_matched (retries) ──► failed ──► closed (REDEMPTION)
cancelled
```

### Exécution sim vs réel

Les deux modes partagent `prepareFakMarketOrder` (VWAP book, slippage, tick, resserrement SELL `lastTradePrice` si book présent, MOS, hold-if-winning). Divergence ensuite :

| | Simulation | Réel |
|--|--|--|
| Placement | Latence `SIM_EXECUTION_LATENCY_MS` (défaut 150) puis FAK local sur book **T1** (`forceRefreshBook`) | `createAndPostMarketOrder` FAK |
| Book T1 vide / hors limit | `order_not_matched` | `order_not_matched` (réponse CLOB) |
| Hold-if-winning | Décidé dans prepare (avant match), comme le réel | Avant POST |

Pas de POST CLOB en sim. Réglages : **Simulation → Exécution sim** ou voir [simulation-execution.md](./simulation-execution.md).
Statuts définis dans `CopiedPositionStatus` (`packages/core/src/types/index.ts`).
