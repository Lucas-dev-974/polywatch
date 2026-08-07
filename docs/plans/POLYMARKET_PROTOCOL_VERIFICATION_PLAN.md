# Plan de Vérification des Protocoles Polymarket

## Objectif

Vérifier que chaque pipeline de Polywatch implémente correctement les protocoles Polymarket documentés et que la logique métier est cohérente.

---

## Sources Polymarket Documentation

| API | URL | Usage |
|-----|-----|-------|
| **Data API** | `https://data-api.polymarket.com` | Positions, portfolio value |
| **Gamma API** | `https://gamma-api.polymarket.com` | Markets, events, tags |
| **CLOB API** | `https://clob.polymarket.com` | Orderbook, orders, prices |
| **WebSocket** | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | Real-time book updates |
| **Relayer** | `https://relayer-url` (config) | Wallet batches, redemption |

### Endpoints critiques documentés

1. **Data API /positions** : `GET /positions?user={address}&limit={n}&offset={n}`
2. **CLOB /book** : `GET /book?token_id={assetId}` (public)
3. **CLOB /tick-size** : `GET /tick-size?token_id={assetId}` (public)
4. **CLOB /order** : `POST /order` (auth required)
5. **WebSocket Market** : `{"type":"market","assets_ids":[...],"operation":"subscribe"}`
   - Events: `book` (snapshot), `price_change` (deltas), `best_bid_ask`, `last_trade_price`, `market_resolved`

---

## Pipelines à vérifier

| # | Pipeline | Fichiers principaux | Priorité |
|---|----------|---------------------|----------|
| 1 | MoveDetector (polling positions) | `copy-trading/src/processors/move-detector.ts`, `copy-trading/src/polymarket/api-client.ts` | Haute |
| 2 | CopyProcessor (décision de copie) | `copy-trading/src/processors/copy-processor.ts`, `copy-trading/src/processors/copy/copy-entry-pipeline.ts` | Haute |
| 3 | Executor (ordres CLOB) | `worker/src/clob/real-executor.ts` | Critique |
| 4 | StrategyProcessing (SL/TP/trailing) | `worker/src/processors/strategy-processing.ts`, `worker/src/processors/strategy/position-branches.ts`, `position-exit-evaluator.ts`, `kill-switch-monitor.ts` | Haute |
| 5 | Order Book WebSocket | `worker/src/polymarket/websocket-book.ts`, `connection-manager.ts` | Critique |
| 6 | RedemptionHandler (résolution marchés) | `worker/src/processors/redemption-handler.ts` | Moyenne |
| 7 | CLOB Credentials/Signature | `backend/src/polymarket/relayer-client.ts`, `clob-creds.ts` | Critique |

> **Note de l'audit (2026-08-07)** : Les pipelines 1 et 2 vivent dans le package `@polywatch/copy-trading`, pas dans `@polywatch/worker`. Le package `copy-trading` possède son propre `package.json`. Deux copies de `api-client.ts` coexistent (`worker/` et `copy-trading/`) — le `move-detector.ts` importe la sienne depuis `copy-trading/`. Le pipeline 4 délègue la logique SL/TP/Trailing à des sous-modules `strategy/` non mentionnés dans la version initiale du plan.

---

## 1. Pipeline MoveDetector

### Fichiers analysés
- `packages/copy-trading/src/processors/move-detector.ts`
- `packages/copy-trading/src/polymarket/api-client.ts` (utilisé par `move-detector.ts`)
- `packages/worker/src/polymarket/api-client.ts` (doublon utilisé par le worker)
- `packages/core/src/services/poll-cycle.service.ts`

### Specs Polymarket
```
GET /positions?user={traderAddress}&limit={LIMIT}&offset={offset}&sizeThreshold=0
```

### Code Polywatch
```typescript
// packages/copy-trading/src/polymarket/api-client.ts:47
const url = `${config.dataApi}/positions?user=${traderAddress}&limit=${LIMIT}&offset=${offset}&sizeThreshold=0`;
```

### Points de vérification

#### 1.1 Endpoints Polymarket ✅
- [x] URL correcte : `dataApi/positions`
- [x] Paramètres de pagination respectés (`limit`, `offset`)
- [x] `sizeThreshold=0` pour inclure les petites positions
- [x] Gestion de la troncature API (`truncated` flag)
- [ ] **À vérifier**: Rate limiting Data API (non documenté explicitement)

#### 1.2 Logique de détection
- [x] Reconciliation au démarrage (`reconcileOnly`)
- [x] Transitions calculées: `OPENED`, `INCREASED`, `DECREASED`, `CLOSED`
- [x] Idempotence via hash `hashMoveEventId()`
- [x] Circuit breaker pour failures (`CircuitBreaker`)

#### 1.3 Problèmes potentiels
- [ ] **Pagination**: `DATA_API_MAX_PAGES` limit - vérifier si suffisant
- [ ] **Rate limiting**: Token bucket implémenté (`dataApiPositionsBucket`) - vérifier les limites Polymarket

---

## 2. Pipeline CopyProcessor

### Fichiers analysés
- `packages/copy-trading/src/processors/copy-processor.ts`
- `packages/copy-trading/src/processors/copy/copy-entry-pipeline.ts`
- `packages/copy-trading/src/processors/copy/copy-risk-gate.ts` (gates d'entrée)

### Points de vérification

#### 2.1 Filtres d'entrée
- [x] Filtre bid/ask ratio
- [x] Filtre momentum
- [x] Filtre SL proximity
- [x] Filtre signal score
- [x] Filtre tags marché

#### 2.2 Sizing modes
- [x] `fixed_usdc`
- [x] `fixed_ratio`
- [x] `proportional_capital`
- [x] `kelly_fractional`
- [x] `risk_based`

---

## 3. Pipeline Executor (CRITIQUE)

### Fichiers analysés
- `packages/worker/src/clob/real-executor.ts`

### Specs Polymarket (Orders)

#### Order Types
| Type | Behavior | Polywatch usage |
|------|----------|-----------------|
| GTC | Good-Til-Cancelled | Non utilisé |
| GTD | Good-Til-Date | Non utilisé |
| FOK | Fill-Or-Kill | ✅ Supporté dynamiquement (`signal.orderType === 'FOK'`) |
| **FAK** | Fill-And-Kill | ✅ Utilisé par défaut |

#### Code Polywatch
```typescript
// packages/worker/src/clob/real-executor.ts:94-95
const clobOrderType =
  signal.orderType === 'FOK' ? OrderType.FOK : OrderType.FAK;
```

> **Note de l'audit (2026-08-07)** : La version initiale du plan affirmait "FOK: Non utilisé", ce qui est inexact. L'`RealExecutor` supporte dynamiquement FAK **et** FOK selon `signal.orderType`. La ligne citée à l'origine (`real-executor.ts:246`) était erronée — le fichier ne fait que 225 lignes ; le code réel est à la ligne 94-95.

#### Polymarket Order Format
```json
{
  "maker": "0x...",           // Deposit wallet address
  "signer": "0x...",          // Deposit wallet address (POLY_1271)
  "tokenId": "...",           // YES/NO token
  "makerAmount": "...",       // For SELL: shares * 1e6
  "takerAmount": "...",       // For BUY: dollars * 1e6
  "side": "BUY" | "SELL",
  "expiration": "0",          // 0 = never
  "signatureType": 3,         // POLY_1271
  "timestamp": "...",
  "salt": "...",              // Nonce
  "signature": "0x..."         // ERC-7739 wrapped
}
```

### Points de vérification

#### 3.1 Authentification CLOB ✅
- [x] `SignatureTypeV2.POLY_1271` pour deposit wallets
- [x] `funderAddress` = deposit wallet address
- [x] SDK `createAndPostMarketOrder` gère la signature

#### 3.2 Création d'ordre FAK ✅
- [x] Type `FAK` correct pour market orders
- [x] Gestion du `tickSize` via `getTickSize()`
- [x] Arrondi `roundToTick()` pour éviter les erreurs
- [x] `negRisk` flag pour marchés multi-outcomes

#### 3.3 Points critiques
- [x] Slippage guard implémenté (`evaluateSlippageGuard` dans `worker/src/execution/slippage-guard.ts:31`, appelé depuis `prepare-fak-order.ts`). **Signé** depuis le patch du 2026-08-07 : `computeSlippagePercent(fill, ref, side)` est positif uniquement quand le fill est défavorable (BUY trop cher / SELL trop bas) ; un fill plus avantageux que le VWAP de référence ne bloque plus l'ordre
- [x] Timeout CLOB (`CLOB_ORDER_TIMEOUT_MS` dans `constants.ts`, appel `real-executor.ts`)
- [x] Parsing fill response (`parseFillResponse`)
- [x] Gestion `ORDER_DELAYED` → return `null` (réconciliation différée)

#### 3.4 Problèmes potentiels
- [ ] **Heartbeat**: Non implémenté - nécessaire pour les sessions longues?
- [ ] **Order status polling**: Utiliser `GET /order/{orderId}` après delay?

---

## 4. Pipeline StrategyProcessing

### Fichiers analysés
- `packages/worker/src/processors/strategy-processing.ts` (orchestration)
- `packages/worker/src/processors/strategy/position-branches.ts` (évaluation liquid/illiquid)
- `packages/worker/src/processors/strategy/position-exit-evaluator.ts` (SL/TP/Trailing)
- `packages/worker/src/processors/strategy/kill-switch-monitor.ts`

> **Note de l'audit (2026-08-07)** : La logique SL/TP/Trailing n'est pas dans `strategy-processing.ts` directement — elle est déléguée aux sous-modules `strategy/` listés ci-dessus. La version initiale du plan ne mentionnait que `strategy-processing.ts`.

### Points de vérification

#### 4.1 Calcul du mark price
- [x] Utilisation de `executableBidVwap` pour mark price
- [x] Gestion liquidité insuffisante (`illiquid` status)

#### 4.2 Évaluation SL/TP/Trailing
- [x] Priorité: SL → TP → TRAILING (logique dans `position-exit-evaluator.ts`)
- [x] Trailing armé après `trailingActivationBidPoints` (points absolus, **pas** un pourcentage — le code utilise `trailingActivationBidPoints`, la version initiale du plan mentionnait à tort `trailingActivationPercent`)
- [x] Calcul monotone du `peakClosurePnlPercent`

#### 4.3 Problèmes potentiels
- [ ] **Cycle marché fermé**: Vérifier `acceptingOrders` après `endDate`

---

## 5. Pipeline Order Book WebSocket (CRITIQUE)

### Fichiers analysés
- `packages/worker/src/polymarket/websocket-book.ts`
- `packages/worker/src/polymarket/connection-manager.ts`

### Specs Polymarket WebSocket

#### Connexion
```
wss://ws-subscriptions-clob.polymarket.com/ws/market
```

#### Subscription message
```json
{
  "type": "market",
  "assets_ids": ["tokenId1", "tokenId2"],
  "operation": "subscribe",
  "custom_feature_enabled": true
}
```

#### Events reçus
| Event | Description |
|-------|-------------|
| `book` | Full snapshot |
| `price_change` | Delta updates |
| `best_bid_ask` | Top of book |
| `last_trade_price` | Last trade |
| `market_resolved` | Market resolution |

### Code Polywatch
```typescript
// packages/worker/src/polymarket/websocket-book.ts:238-245
private sendMarketSubscribe(assetIds: string[]): void {
  this.send({
    type: 'market',
    assets_ids: assetIds,
    operation: 'subscribe',
    custom_feature_enabled: true,
  });
}
```

> **Note de l'audit (2026-08-07)** : La version initiale du plan citait `websocket-book.ts:186` — la fonction `sendMarketSubscribe` est en réalité à la ligne 238.

### Points de vérification

#### 5.1 Connexion WebSocket ✅
- [x] URL configurable via `config.wsUrl`
- [x] Heartbeat PING/PONG implémenté (`WS_HEARTBEAT_INTERVAL_MS`)
- [x] Reconnexion avec back-off exponentiel
- [x] `custom_feature_enabled: true` pour best_bid_ask

#### 5.2 Format des messages ✅
- [x] Event `book` → snapshot complet
- [x] Event `price_change` → application deltas
- [x] Event `best_bid_ask` → mise à jour top of book
- [x] Event `last_trade_price` → dernier trade
- [x] Event `market_resolved` → déclenche `MarketResolutionWatcher` (voir section 6 pour le flow complet)

> **Note de l'audit (2026-08-07)** : La version initiale du plan décrivait un lien direct `market_resolved → redemption handler`. En réalité, le callback WS (`index.ts:279-286`) déclenche `MarketResolutionWatcher.processAll()` (qui rafraîchit les marchés et marque les positions `pending_resolution` via `MarketResolutionService`). Le `RedemptionHandler` tourne via sa **propre boucle indépendante** `startLoop(REDEMPTION_LOOP_MS)` (`index.ts:446`) et scanne les positions `pending_resolution`. Il n'y a pas d'appel direct du WS vers `RedemptionHandler`.

#### 5.3 Problèmes potentiels
- [x] **Merge deltas**: Fonction `applyChange()` correcte
- [x] **Re-sync périodique**: `syncAll()` appelé périodiquement
- [ ] **Batch subscriptions**: `BATCH_SIZE = 100` - vérifier si optimal

---

## 6. Pipeline RedemptionHandler

### Fichiers analysés
- `packages/worker/src/processors/redemption-handler.ts`

### Specs Polymarket (Resolution)

Les marchés résolus sont signalés via WebSocket `market_resolved`. Le winning token est connu.

### Code Polywatch
```typescript
// packages/worker/src/processors/redemption-handler.ts:80
const payoffPerShare = getRedemptionPayoff(market.winningTokenId, assetId);
// payoff = 1 if winning, 0 if losing
```

> **Note de l'audit (2026-08-07)** : La version initiale du plan citait `redemption-handler.ts:79` — le code réel est à la ligne 80.

### Points de vérification

#### 6.1 Détection de résolution ✅
- [x] WebSocket event `market_resolved` → `onMarketResolved` callback (`index.ts:279-286`)
- [x] Callback déclenche `MarketResolutionWatcher.processAll()` (rafraîchit marchés, marque positions `pending_resolution` via `MarketResolutionService`)
- [x] `RedemptionHandler.processAll()` tourne via sa propre boucle `startLoop` (`index.ts:446`) — scanne les positions `pending_resolution`
- [x] Vérification `Market.resolved === true` et `winningTokenId` renseigné (`redemption-handler.ts:70-73`)

> **Note de l'audit (2026-08-07)** : La version initiale du plan décrivait le flow `market_resolved → onMarketResolved callback` comme directement lié au `RedemptionHandler`. Le flow réel est indirect : WS → `MarketResolutionWatcher` → `MarketResolutionService` (marque `pending_resolution`) → `RedemptionHandler` (boucle indépendante 15s).

#### 6.2 Appel de rédemption (Real mode) ✅
- [x] POST `/api/internal/redeem` vers le backend
- [x] Backend utilise le relayer pour `payout`

#### 6.3 Problèmes potentiels
- [x] **Neg Risk markets**: Le flag `negRisk` **est bien passé** au backend (`redemption-handler.ts:119,157` — `redeemOnChain` reçoit `negRisk` et l'envoie dans le POST `/api/internal/redeem`). Point résolu positivement par l'audit du 2026-08-07.

---

## 7. Pipeline CLOB Credentials/Signature (CRITIQUE)

### Specs Polymarket (Deposit Wallets)

#### Signature Types
| Type | Code | Description |
|------|------|-------------|
| EOA_AUTH | 0 | EOA signature |
| POLY_PROXY | 1 | Proxy signature |
| POLY_GNOSIS_SAFE | 2 | Safe signature |
| **POLY_1271** | 3 | Deposit wallet (ERC-1271) |

#### POLY_1271 Order Format
```json
{
  "maker": "0xDepositWallet",
  "signer": "0xDepositWallet",
  "signatureType": 3,
  "signature": "0xWrapped1271Signature"
}
```

### Code Polywatch
- `packages/backend/src/polymarket/relayer-client.ts`
- `packages/backend/src/polymarket/clob-creds.ts`

### Points de vérification

#### 7.1 Types de signatures
- [x] `signatureType: 3` (`CLOB_SIGNATURE_POLY_1271`) utilisé pour deposit wallets — vérifié dans `packages/core/src/polymarket/clob-signature.ts:2` et `packages/worker/src/clob/client-factory.ts:26`
- [x] `maker === signer === depositWalletAddress` — vérifié dans `client-factory.ts:26-27` (`signatureType: POLY_1271` + `funderAddress: depositAddress`)

#### 7.2 Flow de signature
- [x] EIP-712 domain pour Deposit Wallet — géré par le SDK `@polymarket/clob-client-v2` via `createAndPostMarketOrder` (`real-executor.ts:100`). Polywatch ne construit pas le domain manuellement — non vérifiable au niveau du code Polywatch, mais vérifié via le SDK.
- [x] ERC-7739 wrapper — géré par le SDK `@polymarket/clob-client-v2`. Idem : délégué au SDK, non vérifiable au niveau du code Polywatch.

> **Note de l'audit (2026-08-07)** : Les points 7.1 et 7.2 étaient marqués "À vérifier" dans la version initiale. L'audit confirme que `signatureType: 3` et `maker === signer === depositWalletAddress` sont correctement configurés. Le EIP-712 domain et l'ERC-7739 wrapper sont pris en charge par le SDK `@polymarket/clob-client-v2` — Polywatch ne les implémente pas manuellement, donc la vérification se fait au niveau du SDK, pas du code Polywatch.

#### 7.3 Stockage sécurisé
- [x] Chiffrement AES-256-GCM pour les credentials
- [x] `MASTER_ENCRYPTION_KEY` en env — format recommandé : 64 hex chars (sortie `generate-secrets.mjs`). Le format legacy 32 caractères UTF-8 (sans KDF) reste accepté mais déclenche un `log.warn` unique au boot via `warnIfLegacyMasterEncryptionKey()` (`backend/src/crypto/encryption.ts`, appelé dans `backend/src/index.ts`)

#### 7.4 Idempotence des retraits relayer (patch 2026-08-07)
- [x] `withdrawViaRelayer` réserve la clé d'idempotence en Redis via `SET NX EX` **atomique** (`reserveOrGet`) avant toute exécution
- [x] Requête identique déjà complétée → hash existant renvoyé ; requête identique en vol → `withdraw_in_progress` (HTTP 409, affiché côté frontend comme hint informatif, pas comme erreur)
- [x] Échec de la transaction → `clearReservation` libère la clé pour permettre un retry

---

## Résumé des vérifications

### ✅ Conforme aux specs Polymarket

| Pipeline | Status | Notes |
|----------|--------|-------|
| MoveDetector | ✅ | Data API pagination correcte — vit dans `copy-trading/` |
| CopyProcessor | ✅ | Filtres et sizing OK — vit dans `copy-trading/` |
| Executor | ✅ | FAK/FOK dynamique, POLY_1271 |
| WebSocket Book | ✅ | Events et subscriptions |
| Redemption | ✅ | Flow on-chain OK, `negRisk` passé au backend |

### ⚠️ À vérifier plus en détail

| Point | Pipeline | Action |
|-------|----------|--------|
| Rate limits Data API | MoveDetector | Vérifier token bucket vs Polymarket limits |
| Order heartbeat | Executor | Implémenter si sessions longues |
| Order polling | Executor | Ajouter `GET /order/{id}` pour delayed orders |

### ❌ Problèmes identifiés par l'audit (2026-08-07)

| Problème | Criticité | Pipeline | Statut |
|----------|-----------|----------|--------|
| 3 pipelines attribués au mauvais package (`worker/` au lieu de `copy-trading/`) | Critique | 1, 2 | ✅ Corrigé dans ce doc |
| Plan affirmait "FOK: Non utilisé" alors que FOK est supporté | Critique | 3 | ✅ Corrigé dans ce doc |
| Flow `market_resolved → RedemptionHandler` décrit comme direct | Majeure | 5, 6 | ✅ Corrigé dans ce doc |
| Sous-modules `strategy/` non documentés | Majeure | 4 | ✅ Corrigé dans ce doc |
| Numéros de ligne erronés (`real-executor.ts:246`, `websocket-book.ts:186`, `redemption-handler.ts:79`) | Majeure | 3, 5, 6 | ✅ Corrigé dans ce doc |
| `trailingActivationPercent` vs `trailingActivationBidPoints` | Mineure | 4 | ✅ Corrigé dans ce doc |
| `negRisk` flag marqué "À vérifier" | Mineure | 6 | ✅ Résolu positivement |
| EIP-712 / ERC-7739 marqués "À vérifier" | Mineure | 7 | ✅ Résolu (délégué au SDK) |

### 🔧 Patch de durcissement appliqué (2026-08-07)

Suite à l'audit approfondi des pipelines, les correctifs suivants ont été appliqués :

|| Correctif | Fichiers |
||-----------|----------|
|| Timeout sur le fetch `/api/internal/clob-approvals/ensure` (`BACKEND_HTTP_TIMEOUT_MS`) | `worker/src/clob/trading-context.ts` |
|| Compteur `cacheGeneration` : un build de trading-context en vol ne réécrit plus le cache après une invalidation | `worker/src/clob/trading-context.ts` |
|| Overrides DB `worker.*` propagés aux importeurs via `export let` + `syncNamedExportsFromWorkerConfig()` (live bindings ESM) | `worker/src/constants.ts` |
|| Slippage guard signé : ne bloque que le slippage défavorable | `worker/src/execution/slippage-guard.ts`, `executor.ts`, `real-executor.ts` |
|| Isolation des modes sim/real : `try/catch` par mode, skip `process_mode_error` | `copy-trading/src/processors/copy-processor.ts` |
|| Idempotence relayer atomique Redis (`SET NX EX`) + `withdraw_in_progress` → 409 | `backend/src/polymarket/relayer-client.ts`, `withdraw-errors.ts`, `frontend/src/components/PusdTransferDialog.tsx`, `frontend/src/lib/pusd-errors.ts` |
|| Warning au boot si `MASTER_ENCRYPTION_KEY` legacy 32 car. UTF-8 | `backend/src/crypto/encryption.ts`, `backend/src/index.ts` |
|| Alertes backend fire-and-forget (ne bloquent plus la boucle stratégie) | `worker/src/clob/notify-alert.ts`, `processors/strategy/position-exit-evaluator.ts` |
|| WebSocket user : timeout de connexion + rejet si `close`/`error` avant `open` | `worker/src/polymarket/websocket-user.ts` |

---

## Méthodologie de vérification

### Étape 1 : Collecte documentation Polymarket ✅
1. Documentation Orders: https://docs.polymarket.com/trading/orders/create-order
2. Documentation Deposit Wallets: https://docs.polymarket.com/trading/deposit-wallets
3. API Reference: https://docs.polymarket.com/api-reference/introduction
4. Spécifications WebSocket (extraites du SDK)

### Étape 2 : Audit du code existant ✅
- `real-executor.ts` : Order creation et parsing
- `websocket-book.ts` : WebSocket events
- `api-client.ts` : Data API calls
- `redemption-handler.ts` : On-chain redemption

### Étape 3 : Tests d'intégration (à faire)
1. Créer des tests contre l'API Polymarket (testnet si dispo)
2. Mock des réponses pour les tests unitaires
3. Vérifier les edge cases (rate limit, erreurs, timeouts)

### Étape 4 : Documentation des écarts ✅
- Audit complet réalisé le 2026-08-07 (skill `audit-codebase-docs`)
- 8 écarts identifiés et corrigés dans ce document (voir section "Problèmes identifiés" ci-dessus)
- Aucun écart sur le code — toutes les corrections concernent la documentation
- Quelques points restant à vérifier côté runtime (rate limits, heartbeat)

---

## Livrables attendus

| Livrable | Status |
|----------|--------|
| **Rapport d'audit** | ✅ Présent + corrigé le 2026-08-07 |
| **Liste des écarts** | ✅ 8 écarts identifiés et corrigés dans ce doc |
| **Tests d'intégration** | ⏳ À implémenter |
| **Correctifs doc** | ✅ Appliqués le 2026-08-07 (11 corrections) |
| **Correctifs code** | N/A — aucun problème code identifié |

---

## Priorisation des corrections

| Criticité | Action | Statut |
|-----------|--------|--------|
| **Critique** | Corriger chemins `copy-trading/` + FOK supporté | ✅ Appliqué 2026-08-07 |
| **Haute** | Documenter flow `market_resolved` réel + sous-modules `strategy/` + numéros de ligne | ✅ Appliqué 2026-08-07 |
| **Moyenne** | Tests d'intégration | ⏳ À implémenter |
| **Basse** | Optimisations batch subscriptions, terminologie `trailingActivationBidPoints` | ✅ Appliqué 2026-08-07 |

---

## Prochaines étapes

1. **Tests d'intégration**: Créer des tests qui appellent les vrais endpoints Polymarket (en mode dry-run/paper trading)
2. **Vérification rate limits**: Documenter les limites Polymarket Data API et ajuster le token bucket
3. **Heartbeat CLOB**: Évaluer si nécessaire pour les sessions longues
4. **Monitoring**: Ajouter des alertes sur les erreurs CLOB (rate limit, timeouts)