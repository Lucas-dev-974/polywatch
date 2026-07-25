# Rapport de Vérification des Protocoles Polymarket

**Date :** 2025-06-24  
**Auditeur :** ProjectManager-Agent  
**Version Polywatch :** v0.9  
**Status :** ✅ Vérification complète

---

## Résumé Exécutif

| Pipeline | Status | Conformité |
|----------|--------|------------|
| 1. MoveDetector | ✅ Vérifié | Conforme |
| 2. CopyProcessor | ✅ Vérifié | Conforme |
| 3. Executor (CLOB) | ✅ Vérifié | Conforme |
| 4. StrategyProcessing | ✅ Vérifié | Conforme |
| 5. WebSocket Book | ✅ Vérifié | Conforme |
| 6. RedemptionHandler | ✅ Vérifié | Conforme |
| 7. CLOB Credentials/Signature | ✅ Vérifié | Conforme |

**Aucun problème critique identifié.** Tous les pipelines sont conformes aux spécifications Polymarket documentées.

---

## 1. Pipeline MoveDetector

### Fichiers vérifiés
- `packages/worker/src/processors/move-detector.ts`
- `packages/worker/src/polymarket/api-client.ts`
- `packages/worker/src/polymarket/token-bucket.ts`
- `packages/worker/src/polymarket/rate-limited-fetch.ts`
- `packages/worker/src/constants.ts`

### Résultats

| Point | Status | Détail |
|-------|--------|--------|
| Endpoint Data API `/positions` | ✅ | `dataApi/positions?user={addr}&limit={LIMIT}&offset={offset}&sizeThreshold=0` |
| Pagination | ✅ | `DATA_API_PAGE_LIMIT=500`, `DATA_API_MAX_PAGES=20` → max 10 000 positions |
| Flag `truncated` | ✅ | Remonté et loggé quand la limite de pages est atteinte |
| Circuit breaker | ✅ | 5 échecs → 30s cooldown, état signalé au backend |
| Idempotence via hash | ✅ | `hashMoveEventId()` SHA-256 avec `normalizeSize()` (6 décimales) |
| Rate limiting | ✅ | Token bucket `dataApiPositionsBucket` = 150 req/10s |
| Retry 429 | ✅ | `rateLimitedFetch()` avec 3 retries, backoff exponentiel + jitter |
| Reconcilation au démarrage | ✅ | `reconcileOnly` pour les nouveaux traders |

### ⚠️ Observations
- **DATA_API_MAX_PAGES=20** : suffisant pour la plupart des traders. Un trader avec >10 000 positions actives verra `truncated=true` et les CLOSED ne seront pas inférées pour les positions hors pagination. C'est un edge case acceptable.
- **Token bucket 150 req/10s** : pas de limite officielle documentée par Polymarket pour la Data API. 150 req/10s = 15 req/s est conservateur et sûr.

---

## 2. Pipeline CopyProcessor

### Fichiers vérifiés
- `packages/worker/src/processors/copy-processor.ts`
- `packages/worker/src/processors/copy/copy-entry-pipeline.ts`

### Résultats

| Point | Status | Détail |
|-------|--------|--------|
| Filtre bid/ask ratio | ✅ | `isEntryBidAskRatioAcceptable()` avec `minBidToAskRatio` configurable |
| Filtre momentum | ✅ | `evaluateMomentumEntry()` — refuse si ask < prix moyen trader |
| Filtre SL proximity | ✅ | Vérifié via `stopDistance` dans le sizing |
| Filtre signal score | ✅ | `computeSignalScore()` avec multiplicateur, seuil à 0.2 |
| Filtre tags marché | ✅ | `passesMarketTagFilter()` |
| Sizing fixed_usdc | ✅ | Montant fixe en USDC |
| Sizing fixed_ratio | ✅ | Ratio fixe par rapport au trader |
| Sizing proportional_capital | ✅ | Proportionnel au capital disponible |
| Sizing kelly_fractional | ✅ | Critère de Kelly fractionnel |
| Sizing risk_based | ✅ | Budget de risque |
| Min time to close | ✅ | Vérifie `endDate` avant d'entrer |
| Min order size | ✅ | `MIN_ORDER_SHARES` et `MIN_ORDER_USDC` |
| Idempotence réservation | ✅ | `hashCopyOrderSignalId()` SHA-256 |

---

## 3. Pipeline Executor (CRITIQUE)

### Fichiers vérifiés
- `packages/worker/src/clob/real-executor.ts`
- `packages/worker/src/clob/parse-fill-response.ts`
- `packages/worker/src/clob/clob-response-schema.ts`
- `packages/worker/src/clob/clob-amounts.ts`
- `packages/worker/src/clob/with-timeout.ts`

### Résultats

| Point | Status | Détail |
|-------|--------|--------|
| Order type FAK | ✅ | `OrderType.FAK` utilisé pour market orders |
| Tick size | ✅ | `resolveTickSizeCached()` avec cache TTL 300s, LRU 100 entries |
| Round to tick | ✅ | `roundToTick()` avec `toFixed(decimals)` pour éviter les float artifacts |
| Slippage guard | ✅ | `evaluateSlippageGuard()` avec `maxSlippagePercent` configurable |
| Forced exit bypass | ✅ | SL/kill switch skip le slippage guard |
| Timeout CLOB | ✅ | `CLOB_ORDER_TIMEOUT_MS=30_000` via `withTimeout()` |
| POLY_1271 signature | ✅ | `signatureType: 3` via SDK `createAndPostMarketOrder` |
| NegRisk flag | ✅ | `options.negRisk = true` pour marchés multi-outcomes |
| Parse fill response | ✅ | Zod schema validation, `amountPairs()` pour désambiguïsation raw/human |
| ORDER_DELAYED | ✅ | Retourne `null` → réconciliation différée |
| Pre-close hold guard | ✅ | `shouldAbortPreCloseForWinningFill()` |
| Min order size | ✅ | `resolveMinOrderSharesForSignal()` via `getClobMarketInfo` |
| Fee computation | ✅ | `computeTakerFee()` avec `platformFeeParams` |

### ⚠️ Points à surveiller
- **Heartbeat CLOB** : Non implémenté. Le SDK Polymarket ne documente pas de heartbeat nécessaire pour les sessions longues. Les ordres FAK sont instantanés, donc pas de session persistante.
- **Order status polling** : `ORDER_DELAYED` retourne `null` et la réconciliation se fait via le `ExecutionReconciler` (`execution-reconciler.ts`). Pas de polling `GET /order/{id}` explicite — la réconciliation est événementielle via WebSocket.

---

## 4. Pipeline StrategyProcessing

### Fichiers vérifiés
- `packages/worker/src/processors/strategy-processing.ts`

### Résultats

| Point | Status | Détail |
|-------|--------|--------|
| Mark price via executableBidVwap | ✅ | Utilise `connectionManager.getExecutablePrices()` |
| Gestion illiquidité | ✅ | `evaluateIlliquidPosition()` avec status `illiquid` |
| Priorité SL → TP → TRAILING | ✅ | Évalué dans `position-branches.ts` |
| Trailing activation | ✅ | `trailingActivationPercent` + `peakClosurePnlPercent` monotone |
| Kill switch monitor | ✅ | `KillSwitchMonitor` avec intervalle configurable |
| PnL tick publisher | ✅ | `PnlTickPublisher` avec throttle `PNL_TICK_THROTTLE_MS=100` |
| Market refresh near end | ✅ | `refreshMarketsNearEnd()` avec throttle `MARKET_REFRESH_THROTTLE_MS=15_000` |
| Cycle marché fermé | ✅ | `resolveMarkState()` vérifie `acceptingOrders` et `endDate` |

---

## 5. Pipeline WebSocket Book (CRITIQUE)

### Fichiers vérifiés
- `packages/worker/src/polymarket/websocket-book.ts`
- `packages/worker/src/polymarket/connection-manager.ts`

### Résultats

| Point | Status | Détail |
|-------|--------|--------|
| URL WebSocket | ✅ | `config.wsUrl` configurable |
| Format subscription | ✅ | `type: 'market'`, `assets_ids: [...]`, `operation: 'subscribe'` |
| `custom_feature_enabled: true` | ✅ | Pour recevoir `best_bid_ask` |
| Heartbeat PING/PONG | ✅ | `WS_HEARTBEAT_INTERVAL_MS=10_000` |
| Reconnexion back-off | ✅ | Exponentiel : 1s, 2s, 4s, 8s... cap à 300s, max 5 tentatives |
| Event `book` | ✅ | Snapshot complet → `storeBook()` |
| Event `price_change` | ✅ | Deltas → `applyChange()` (merge correct) |
| Event `best_bid_ask` | ✅ | Top of book → `metricsCache.updateTopOfBook()` |
| Event `last_trade_price` | ✅ | Dernier trade → `metricsCache.updateLastTrade()` |
| Event `market_resolved` | ✅ | → callback `onMarketResolved()` |
| Re-sync périodique | ✅ | `syncAll()` appelé via `startPeriodicRefresh()` tous les 10s |
| Batch subscriptions | ✅ | `BATCH_SIZE=100` à la reconnexion |
| Unsubscribe | ✅ | `sendUnsubscribe()` avec `operation: 'unsubscribe'` |

### ⚠️ Observations
- **BATCH_SIZE=100** : La doc Polymarket ne spécifie pas de limite de batch. 100 assets_ids par message est raisonnable. Si un utilisateur suit 500+ marchés, cela nécessite 5 messages de subscription.

---

## 6. Pipeline RedemptionHandler

### Fichiers vérifiés
- `packages/worker/src/processors/redemption-handler.ts`
- `packages/backend/src/routes/internal/clob-ops-routes.ts`
- `packages/backend/src/polymarket/clob-redeem.ts`
- `packages/core/src/market/lifecycle.ts`
- `packages/core/src/polymarket/redemption.ts`
- `packages/core/src/positions/redemption-wait.ts`

### Résultats

| Point | Status | Détail |
|-------|--------|--------|
| Détection résolution WebSocket | ✅ | `market_resolved` → `onMarketResolved` callback |
| Vérification `Market.resolved` | ✅ | `isMarketRedeemable()` via `marketLifecycleFromEntity()` |
| `winningTokenId` renseigné | ✅ | Vérifié avant redemption |
| Payoff calculation | ✅ | `getRedemptionPayoff()` avec `normalizeTokenId()` (strip 0x, lowercase) |
| `resolveWinningOutcome()` | ✅ | Match YES/NO via tokenIdYes/tokenIdNo |
| NegRisk flag | ✅ | Transmis au backend : `market.negRisk ?? false` |
| NegRisk calldata | ✅ | `encodeNegRiskRedeemCalldata()` → `redeemPositions(conditionId, [qty, 0] ou [0, qty])` |
| CTF redeem calldata | ✅ | `encodeCtfRedeemCalldata()` → `redeemPositions(collateral, ZeroHash, conditionId, [1] ou [2])` |
| Relayer deposit wallet | ✅ | `executeDepositWalletBatch()` pour mode deposit |
| Relayer safe/proxy | ✅ | `execute()` avec `RelayerTxType.SAFE` ou `PROXY` |
| Vérification receipt | ✅ | `verifyRedemptionReceipt()` parse les logs `Redeemed` |
| Idempotence redemption | ✅ | `hashRedemptionOrderSignalId()` SHA-256 |
| Claim guard | ✅ | `claimUnlessFilled()` : skip si fill existant ; retourne `false` si une exec `REDEMPTION` est déjà `placing`/`partial` (évite double redeem live) |
| Positions failed aussi traitées | ✅ | `loadFailed()` inclus dans `processAll()` |

---

## 7. Pipeline CLOB Credentials/Signature (CRITIQUE)

### Fichiers vérifiés
- `packages/backend/src/polymarket/clob-creds.ts`
- `packages/backend/src/polymarket/relayer-client.ts`
- `packages/backend/src/polymarket/deposit-wallet-signing.ts`
- `packages/backend/src/polymarket/clob-redeem.ts`

### Résultats

| Point | Status | Détail |
|-------|--------|--------|
| `signatureType: 3` (POLY_1271) | ✅ | `SIGNATURE_TYPE_DEPOSIT_WALLET = 3` dans relayer-client.ts |
| `maker === signer === depositWalletAddress` | ✅ | Confirmé dans real-executor.ts (log ligne 96-97) |
| EIP-712 domain | ✅ | `DEPOSIT_WALLET_DOMAIN_NAME`, `DEPOSIT_WALLET_DOMAIN_VERSION`, `POLYGON_CHAIN_ID` |
| ERC-7739 wrapper | ✅ | Géré par le SDK Polymarket (`ExchangeOrderBuilderV2.buildOrder`) |
| Builder credentials | ✅ | `BuilderApiKeyCreds` avec `key`, `secret`, `passphrase` chiffrés |
| Chiffrement AES-256-GCM | ✅ | `decrypt()` pour builderApiKeyEnc, builderSecretEnc, builderPassphraseEnc |
| Relayer URL configurable | ✅ | `DEFAULT_RELAYER_URL = 'https://relayer-v2.polymarket.com/'` |
| Deposit wallet deadline | ✅ | `DEPOSIT_WALLET_DEADLINE_SECONDS = 600` (10 min) |
| Vérification signature | ✅ | `verifyDepositWalletSignature()` avec `verifyTypedData()` d'ethers |
| Idempotency key withdraw | ✅ | Redis TTL 5 min pour éviter doubles soumissions |

---

## Synthèse des Points ⚠️

| # | Point | Pipeline | Impact | Recommandation |
|---|-------|----------|--------|----------------|
| 1 | Pagination max 10 000 positions | MoveDetector | Faible | Un trader avec >10K positions actives est un edge case rare. Ajouter un log warning si `truncated=true` persiste. |
| 2 | Batch subscriptions 100 assets | WebSocket | Faible | Ajuster si monitoring de >500 marchés simultanés. |
| 3 | Order status polling | Executor | Faible | La réconciliation événementielle via WebSocket + `ExecutionReconciler` est suffisante. |
| 4 | Heartbeat CLOB | Executor | N/A | Non nécessaire pour ordres FAK instantanés. |

**Aucun correctif critique nécessaire.**

---

## Prochaines Étapes Recommandées

1. **Tests d'intégration** : Créer des tests qui appellent les endpoints Polymarket en mode dry-run/paper trading
2. **Monitoring** : Ajouter des alertes sur :
   - `truncated=true` persistant (pagination insuffisante)
   - Taux d'erreurs 429 (rate limiting)
   - `ORDER_DELAYED` fréquents (latence CLOB)
3. **Documentation** : Mettre à jour `docs/api.md` avec les endpoints vérifiés

---

*Rapport généré par ProjectManager-Agent — vérification complète des 7 pipelines.*
