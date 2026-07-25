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
| 1 | MoveDetector (polling positions) | `worker/src/processors/move-detector.ts` | Haute |
| 2 | CopyProcessor (décision de copie) | `worker/src/processors/copy-processor.ts`, `copy/copy-entry-pipeline.ts` | Haute |
| 3 | Executor (ordres CLOB) | `worker/src/clob/real-executor.ts` | Critique |
| 4 | StrategyProcessing (SL/TP/trailing) | `worker/src/processors/strategy-processing.ts` | Haute |
| 5 | Order Book WebSocket | `worker/src/polymarket/websocket-book.ts`, `connection-manager.ts` | Critique |
| 6 | RedemptionHandler (résolution marchés) | `worker/src/processors/redemption-handler.ts` | Moyenne |
| 7 | CLOB Credentials/Signature | `backend/src/polymarket/relayer-*.ts`, `clob-creds.ts` | Critique |

---

## 1. Pipeline MoveDetector

### Fichiers analysés
- `packages/worker/src/processors/move-detector.ts`
- `packages/worker/src/polymarket/api-client.ts`
- `packages/core/src/services/poll-cycle.service.ts`

### Specs Polymarket
```
GET /positions?user={traderAddress}&limit={LIMIT}&offset={offset}&sizeThreshold=0
```

### Code Polywatch
```typescript
// api-client.ts:45
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
- `packages/worker/src/processors/copy-processor.ts`
- `packages/worker/src/processors/copy/copy-entry-pipeline.ts`

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
| FOK | Fill-Or-Kill | Non utilisé |
| **FAK** | Fill-And-Kill | ✅ Utilisé |

#### Code Polywatch
```typescript
// real-executor.ts:246
orderType: OrderType.FAK
```

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
- [x] Slippage guard implémenté (`evaluateSlippageGuard`)
- [x] Timeout CLOB (`CLOB_ORDER_TIMEOUT_MS`)
- [x] Parsing fill response (`parseFillResponse`)
- [x] Gestion `ORDER_DELAYED` → return `null` (réconciliation différée)

#### 3.4 Problèmes potentiels
- [ ] **Heartbeat**: Non implémenté - nécessaire pour les sessions longues?
- [ ] **Order status polling**: Utiliser `GET /order/{orderId}` après delay?

---

## 4. Pipeline StrategyProcessing

### Fichiers analysés
- `packages/worker/src/processors/strategy-processing.ts`

### Points de vérification

#### 4.1 Calcul du mark price
- [x] Utilisation de `executableBidVwap` pour mark price
- [x] Gestion liquidité insuffisante (`illiquid` status)

#### 4.2 Évaluation SL/TP/Trailing
- [x] Priorité: SL → TP → TRAILING
- [x] Trailing armé après `trailingActivationPercent`
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
// websocket-book.ts:186
private sendMarketSubscribe(assetIds: string[]): void {
  this.send({
    type: 'market',
    assets_ids: assetIds,
    operation: 'subscribe',
    custom_feature_enabled: true,
  });
}
```

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
- [x] Event `market_resolved` → trigger redemption handler

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
// redemption-handler.ts:79
const payoffPerShare = getRedemptionPayoff(market.winningTokenId, assetId);
// payoff = 1 if winning, 0 if losing
```

### Points de vérification

#### 6.1 Détection de résolution ✅
- [x] WebSocket event `market_resolved` → `onMarketResolved` callback
- [x] Vérification `Market.resolved === true`
- [x] `winningTokenId` renseigné

#### 6.2 Appel de rédemption (Real mode) ✅
- [x] POST `/api/internal/redeem` vers le backend
- [x] Backend utilise le relayer pour `payout`

#### 6.3 Problèmes potentiels
- [ ] **Neg Risk markets**: Vérifier le flag `negRisk` passé au backend

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
- [ ] Vérifier que `signatureType: 3` est utilisé pour deposit wallets
- [ ] Vérifier que `maker === signer === depositWalletAddress`

#### 7.2 Flow de signature
- [ ] Vérifier EIP-712 domain pour Deposit Wallet
- [ ] Vérifier ERC-7739 wrapper

#### 7.3 Stockage sécurisé
- [x] Chiffrement AES-256-GCM pour les credentials
- [x] `MASTER_ENCRYPTION_KEY` en env

---

## Résumé des vérifications

### ✅ Conforme aux specs Polymarket

| Pipeline | Status | Notes |
|----------|--------|-------|
| MoveDetector | ✅ | Data API pagination correcte |
| CopyProcessor | ✅ | Filtres et sizing OK |
| Executor | ✅ | FAK orders, POLY_1271 |
| WebSocket Book | ✅ | Events et subscriptions |
| Redemption | ✅ | Flow on-chain OK |

### ⚠️ À vérifier plus en détail

| Point | Pipeline | Action |
|-------|----------|--------|
| Rate limits Data API | MoveDetector | Vérifier token bucket vs Polymarket limits |
| Order heartbeat | Executor | Implémenter si sessions longues |
| Order polling | Executor | Ajouter `GET /order/{id}` pour delayed orders |
| Deposit Wallet signature | CLOB creds | Vérifier ERC-7739 wrapper |

### ❌ Problèmes identifiés

| Problème | Criticité | Pipeline |
|----------|-----------|----------|
| Aucun problème critique | - | - |

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
- Aucun écart critique identifié
- Quelques points à vérifier (rate limits, heartbeat)

---

## Livrables attendus

| Livrable | Status |
|----------|--------|
| **Rapport d'audit** | ✅ Présent |
| **Liste des écarts** | ✅ Aucun écart critique |
| **Tests d'intégration** | ⏳ À implémenter |
| **Correctifs** | N/A - pas de problème identifié |

---

## Priorisation des corrections

| Criticité | Action |
|-----------|--------|
| **Critique** | Aucune nécessaire |
| **Haute** | Vérifier rate limits, heartbeat |
| **Moyenne** | Tests d'intégration |
| **Basse** | Optimisations batch subscriptions |

---

## Prochaines étapes

1. **Tests d'intégration**: Créer des tests qui appellent les vrais endpoints Polymarket (en mode dry-run/paper trading)
2. **Vérification rate limits**: Documenter les limites Polymarket Data API et ajuster le token bucket
3. **Heartbeat CLOB**: Évaluer si nécessaire pour les sessions longues
4. **Monitoring**: Ajouter des alertes sur les erreurs CLOB (rate limit, timeouts)