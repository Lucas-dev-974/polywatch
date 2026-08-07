# Plan d'implémentation: WebSockets pour Crypto-Algo

## Contexte actuel

Le worker crypto-algo utilise un polling périodique (30s par défaut):
- `StrategyRunner.tick()` évalue toutes les stratégies sur tous les marchés actifs
- Les outcome prices YES/NO viennent de l'API Gamma REST (cache 30s)
- Pas de réactivité temps réel aux changements de marché

## Options d'implémentation

### Option A: WebSockets + Polling Gamma Hybride
**Déclenchement temps réel via WebSockets, prix depuis Gamma**

- S'abonner aux `price_change` et `best_bid_ask` pour chaque marché actif
- Déclencher une évaluation de stratégie sur chaque update significatif
- Garder le polling Gamma pour les outcome prices (ou l'incrémenter à la demande)

**Avantages:**
- Réactivité temps réel aux changements
- Pas besoin de recalibrer les stratégies (mêmes prix Gamma)
- Moins de requêtes API (évaluations déclenchées par events)

**Inconvénients:**
- Deux sources de données (orderbook WS + prix Gamma)
- Latence possible entre signal WS et récupération prix Gamma

---

### Option B: WebSockets uniquement (prix orderbook)
**Prix depuis orderbook, pas d'API Gamma**

- Utiliser `best_bid` / `best_ask` comme approximation des outcome prices
- Moyenne bid/ask comme prix YES approximatif
- Stratégies recalibrées pour ce nouveau prix

**Avantages:**
- Source unique de vérité (WebSockets)
- Temps réel total
- Pas de cache/polling

**Inconvénients:**
- Spread bid/ask peut être significatif (erreur de prix)
- Stratégies à recalibrer (seuils, confiance)
- Pas de distinction YES/NO propre (il faut déduire du tokenId)

---

### Option C: Polling intelligent avec déclencheur WS
**Polling optimisé, WS comme signal de fraîcheur**

- WebSockets s'abonnent aux marchés actifs
- Sur chaque `price_change` ou `best_bid_ask`, invalider le cache Gamma
- Le prochain `tick()` déclenche un fetch Gamma frais
- Optionnel: réduire l'intervalle de polling à 5-10s

**Avantages:**
- Prix exacts (Gamma)
- Cache invalidé intelligemment
- Architecture simple

**Inconvénients:**
- Toujours du polling (mais déclenché par events)
- Plus de requêtes Gamma sur marchés actifs

---

## Architecture proposée (Option A - recommandée)

### Nouveau module: `packages/crypto-algo/src/websocket-price-feed.ts`

```typescript
/**
 * WebSocket price feed for crypto-algo strategies.
 * Subscribes to Polymarket CLOB WebSocket for real-time book updates
 * and triggers strategy evaluation on significant price changes.
 */
export class CryptoAlgoPriceFeed {
  private wsClient: PolymarketBookWebSocket;
  private metricsCache: MarketMetricsCache;
  private onPriceUpdate?: (conditionId: string, assetId: string) => void;
  private onMarketResolved?: (conditionId: string) => void;

  constructor(wsUrl: string, clobApi: string) {
    // Reuse PolymarketBookWebSocket infrastructure
    // but with crypto-algo-specific callbacks
  }

  /**
   * Subscribe to price updates for a set of conditionIds.
   * Maps conditionId -> assetId (tokenIdYes, tokenIdNo) automatically.
   */
  async subscribe(conditionIds: string[], marketService: MarketService): Promise<void>;

  /**
   * Unsubscribe from markets no longer in the active set.
   */
  unsubscribeStale(conditionIds: string[]): void;

  /**
   * Get the latest best bid/ask for an assetId (from WebSocket cache).
   */
  getTopOfBook(assetId: string): { bid: number; ask: number } | null;

  /**
   * Get the mid price (average of bid/ask) as outcome price approximation.
   */
  getMidPrice(assetId: string): number | null;

  /**
   * Register callback fired when a significant price change occurs.
   * Debounced per conditionId to avoid over-evaluation.
   */
  setOnPriceUpdate(cb: (conditionId: string, assetId: string) => void): void;

  /**
   * Register callback fired when a market resolves.
   */
  setOnMarketResolved(cb: (conditionId: string) => void): void;

  /**
   * Start the WebSocket connection.
   */
  connect(): Promise<void>;

  /**
   * Graceful shutdown.
   */
  disconnect(): void;
}
```

### Modifications à `StrategyRunner`

```typescript
// Avant (polling pur)
start(pollMs: number): NodeJS.Timeout {
  this.tickTimer = safeInterval(() => this.tick(), pollMs, '...');
}

// Après (hybride: WS déclencheur + polling fallback)
start(pollMs: number): NodeJS.Timeout {
  // Polling comme fallback de sécurité
  this.tickTimer = safeInterval(() => this.tick(), pollMs, '...');

  // WebSocket déclenche les évaluations en temps réel
  this.priceFeed.setOnPriceUpdate((conditionId, assetId) => {
    // Debounce per conditionId (max 1 eval per 5s per market)
    this.scheduleImmediateTick(conditionId);
  });

  this.priceFeed.setOnMarketResolved((conditionId) => {
    // Disable selection in DB, cleanup
    this.handleMarketResolved(conditionId);
  });
}
```

### Modifications à `naive-momentum.strategy.ts`

```typescript
// Option A: Toujours utiliser les outcome prices Gamma
// mais déclenché par WS

async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  // Prix depuis Gamma (déjà dans market.outcomePrices)
  const yesPrice = market.outcomePrices?.[0]?.price;
  // ... logique inchangée
}

// Option B: Utiliser le mid price depuis orderbook WS
async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  // Prix depuis orderbook WS (injecté via ctx)
  const midPrice = ctx.orderBookMidPrice?.get(market.conditionId);
  // ... logique adaptée aux prix mid
}
```

---

## Plan d'implémentation détaillé (Option A)

### Phase 1: Infrastructure WebSocket
**Durée estimée: 2-3 jours**

1. **Créer `CryptoAlgoPriceFeed`** (`packages/crypto-algo/src/websocket-price-feed.ts`)
   - Wrapper autour de `PolymarketBookWebSocket` existant
   - Mapping conditionId -> assetIds (tokenIdYes, tokenIdNo)
   - Callbacks pour price updates et market resolved

2. **Intégrer dans `index.ts`**
   - Instancier `CryptoAlgoPriceFeed` au démarrage
   - Connecter avant le `StrategyRunner`
   - Passer au `StrategyRunner` via constructeur ou setter

3. **Gérer le cycle de vie**
   - Subscribe aux markets actifs au démarrage
   - Resync sur `SelectionLoader.reload()`
   - Cleanup sur shutdown

### Phase 2: Déclenchement temps réel
**Durée estimée: 1-2 jours**

1. **Debounce per conditionId**
   - Max 1 évaluation par conditionId toutes les 5s
   - Évite le spam sur marchés très actifs

2. **Invalidation cache Gamma**
   - Sur price update WS, marquer le cache Gamma comme stale
   - Force un fetch frais lors de l'évaluation

3. **Fallback polling**
   - Garder le polling périodique comme safety net
   - Intervalle configurable (par défaut 30s, peut augmenter à 60s+)

### Phase 3: Optimisations
**Durée estimée: 1 jour**

1. **Metrics et observabilité**
   - Compter les évaluations déclenchées par WS vs polling
   - Latence entre price change et évaluation
   - Nombre de signaux générés

2. **Tests**
   - Tests unitaires pour `CryptoAlgoPriceFeed`
   - Tests d'intégration avec `StrategyRunner`
   - Mock WebSocket pour tests

---

## Questions à clarifier

1. **Source des prix:** Option A (Gamma pour prix, WS pour déclenchement), B (WS uniquement), ou C (hybride avec invalidation)?

2. **Seuils de stratégie:** Si on utilise les prix orderbook (mid bid/ask), faut-il recalibrer les seuils de `naive-momentum` (0.45, 0.55)?

3. **Gestion du spread:** Sur les marchés peu liquides, le spread bid/ask peut être large. Faut-il un filtre sur le spread maximum avant d'évaluer une stratégie?

4. **Multi-stratégies:** Les stratégies futures auront-elles besoin de l'orderbook complet (profondeur) ou seulement du top bid/ask?

5. **Marchés simultanés:** Combien de marchés actifs en parallèle prévoyez-vous au maximum? (Impact sur le nombre de subscriptions WS)

---

## Risques et mitigations

| Risque | Mitigation |
|--------|------------|
| Déconnexion WS | Fallback polling, reconnexion automatique avec backoff |
| Spam d'évaluations | Debounce per conditionId (min 5s entre évaluations) |
| Désynchronisation prix WS vs Gamma | Utiliser Gamma comme source de vérité, WS comme déclencheur |
| Performance sur N marchés | Batch subscriptions, limiter à 100 marchés actifs max |
| Memory leak sur subscriptions | Cleanup sur market resolved, reconcile périodique |

---

## Prochaines étapes

1. Répondre aux questions ci-dessus
2. Choisir l'option d'implémentation (A, B, ou C)
3. Créer les tickets/tasks détaillés
4. Implémenter phase par phase avec tests
5. Benchmark performance vs polling actuel