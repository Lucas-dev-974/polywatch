# Analyse Crypto-Algo: Gestion des Marchés Court Terme (Up/Down 5min)
## Révision après vérification approfondie du code

> **Note historique (resync 2026-08-07)** : snapshot d'analyse (2025-01). Comportement actuel : [`docs/code/07-crypto-algo.md`](../../code/07-crypto-algo.md). Constantes TTL locales supprimées — TTL via `CryptoConfig` uniquement.

**Date:** 2025-01-27  
**Auteur:** PMA (Project Manager Agent)  
**Scope:** Package `@polywatch/crypto-algo` - Stratégies algorithmiques sur marchés crypto up/down  
**Version:** 2.0 (révisée après inspection code)

---

## 1. Vérification du Mapping Outcome YES/NO

### 1.1 Comment le Mapping Fonctionne

**Dans `market-metadata.ts` (parsing des données Polymarket):**

```typescript
// Lignes 82-100
function mapOutcomeTokens(pairs: { outcome: string; tokenId: string }[]): 
  Pick<GammaMarket, 'tokenIdYes' | 'tokenIdNo'> {
  
  let tokenIdYes: string | null = null;
  let tokenIdNo: string | null = null;

  for (const { outcome, tokenId } of pairs) {
    const normalized = outcome.toLowerCase();
    // ✅ Reconnaît "yes", "up" comme YES
    if (normalized === 'yes' || normalized === 'up') tokenIdYes = tokenId;
    // ✅ Reconnaît "no", "down" comme NO
    if (normalized === 'no' || normalized === 'down') tokenIdNo = tokenId;
  }

  // Fallback: si 2 outcomes, index 0 = YES, index 1 = NO
  if (pairs.length === 2) {
    if (!tokenIdYes) tokenIdYes = pairs[0].tokenId;
    if (!tokenIdNo) tokenIdNo = pairs[1].tokenId;
  }

  return { tokenIdYes, tokenIdNo };
}
```

**Résultat:** `mapOutcomeTokens` fait le mapping correct:
- Marchés "Up/Down" → `up` → YES, `down` → NO ✅
- Marchés "Yes/No" → `yes` → YES, `no` → NO ✅
- Fallback index si outcome non reconnu ✅

### 1.2 Comment les Prix Sont Récupérés

**Dans `parseOutcomePrices` (ligne 147-160):**

```typescript
function parseOutcomePrices(
  outcomes: string[] | undefined,
  outcomePrices: string[] | undefined,
): { outcome: string; price: number }[] {
  const parsed: { outcome: string; price: number }[] = [];
  for (let i = 0; i < len; i++) {
    parsed.push({ outcome: outcomes[i]!, price });
  }
  return parsed;
}
```

**Résultat:** `outcomePricesParsed` contient des objets `{ outcome: string, price: number }`  
Exemple: `[{ outcome: 'Yes', price: 0.65 }, { outcome: 'No', price: 0.35 }]`

### 1.3 Comment la Stratégie Utilise les Données

**Dans `naive-momentum.strategy.ts` (ligne 80-85):**

```typescript
const prices = market.outcomePrices;
if (!prices || prices.length === 0) return null;

// ⚠️ ATTENTION: Utilise prices[0]?.price
const yesPrice = prices[0]?.price;
```

**Données disponibles dans `market`:**
- `market.tokenIdYes` → Token ID YES ✅
- `market.tokenIdNo` → Token ID NO ✅
- `market.outcomePrices` → `[{ outcome: 'Yes', price: 0.65 }, { outcome: 'No', price: 0.35 }]` ✅

### 1.4 Diagnostic du Problème

| Code Actuel | Problème | Sévérité |
|------------|----------|----------|
| `prices[0]?.price` | Suppose que `[0]` = YES | ⚠️ **MOYENNE** |
| `market.tokenIdYes/No` disponibles | Non utilisés pour validation | ⚠️ **MOYENNE** |
| Fallback dans `mapOutcomeTokens` | `pairs[0]` et `pairs[1]` comme fallback | ✅ Cohérent |
| `outcome` dans `outcomePrices` | Non utilisé pour matcher | ⚠️ **MOYENNE** |

**Le mapping EST correct dans la plupart des cas car:**
1. `mapOutcomeTokens` normalise `yes/no` et `up/down` ✅
2. Si outcomes non reconnus, fallback `pairs[0]` = YES, `pairs[1]` = NO ✅
3. Donc `outcomePricesParsed[0]` = YES dans la plupart des cas ✅

**Mais il manque une validation explicite:**
- Si Polymarket change l'ordre dans l'API (improbable mais possible)
- Si un marché a des outcomes "Up/Down" dans un ordre différent
- La stratégie ne le détecterait pas et traderait du mauvais côté

**Score actuel: 7/10**  
Le mapping fonctionne dans la pratique mais repose sur une convention implicite.

---

## 2. Données Disponibles via WebSocket

### 2.1 Ce Que le WebSocket Fournit

**Dans `price-feed.ts` (lignes 148-196):**

```typescript
async subscribeToMarkets(conditionIds: string[], marketService: MarketService): Promise<void> {
  // ✅ Charge tokenIdYes/tokenIdNo depuis DB
  const marketMap = await marketService.loadByConditionIds(conditionIds);
  
  for (const conditionId of conditionIds) {
    const market = marketMap.get(conditionId);
    
    // ✅ Stocke le mapping conditionId → tokenIdYes/tokenIdNo
    this.conditionToAssets.set(conditionId, {
      tokenIdYes: market.tokenIdYes,
      tokenIdNo: market.tokenIdNo,
    });
    
    // ✅ Subscribe aux DEUX tokens (YES et NO)
    if (market.tokenIdYes) assetIds.push(market.tokenIdYes);
    if (market.tokenIdNo) assetIds.push(market.tokenIdNo);
  }
  
  this.wsClient.reconcile(assetIds);
}
```

**Dans `handleBookUpdate` (lignes 316-367):**

```typescript
private handleBookUpdate(assetId: string): void {
  // ✅ Récupère le carnet d'ordres depuis le ConnectionManager
  const book = this.connectionManager.getOrderBook(assetId);
  
  // ✅ Calcule bid, ask, spread, midPrice
  const topOfBook: TopOfBook = {
    bid: bestBid,
    ask: bestAsk,
    spread,
    midPrice: (bestBid + bestAsk) / 2,
    spreadPercent: (spread / bestAsk) * 100,
    updatedAt: Date.now(),
  };
  
  // ✅ Stocke par tokenId
  this.topOfBook.set(assetId, topOfBook);
}
```

### 2.2 Données WebSocket Disponibles

| Donnée | Source | Refresh | Utilisé dans stratégie |
|--------|--------|---------|------------------------|
| `bid`, `ask` | WebSocket ordre book | Temps réel | ✅ via `topOfBook` |
| `spread` | Calculé `(ask - bid)` | Temps réel | ✅ via `spreadPercent` |
| `midPrice` | Calculé `(bid + ask) / 2` | Temps réel | ✅ via `midPrice` |
| `market_resolved` | WebSocket event | On event | ⚠️ Loggé mais pas traité immédiatement |

### 2.3 Données NON Disponibles via WebSocket

| Donnée | Source | TTL | Problème |
|--------|--------|-----|----------|
| `outcomePrices` | Gamma API REST | 30s cache | ⚠️ Pas invalidé par WebSocket |
| `winningTokenId` | Gamma API REST | 30s cache | Pas d'invalidation |
| `acceptingOrders` | DB ou Gamma | Poll 30s | Peut être périmé |

---

## 3. Analyse Détaillée: Cache Gamma vs WebSocket

### 3.1 Flux de Données Complet

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DONNÉES TEMPS RÉEL                                       │
└─────────────────────────────────────────────────────────────────────────────┘

Polymarket WebSocket                    CryptoAlgoPriceFeed
       │                                        │
       ├─ book (order book)                    ├─ topOfBook.set(assetId, {bid, ask, spread, midPrice})
       ├─ price_change                         ├─ triggerEvaluation() [debounce 5s]
       ├─ best_bid_ask                         │
       └─ market_resolved                       └─ onMarketResolved(conditionId)
                                                        │
                                                        ▼
                                           StrategyRunner.handlePriceUpdate()
                                                        │
                                                        ▼
                                           evaluateSelection(selection, topOfBook)
                                                        │
                                                        ▼
                                           strategy.evaluate(marketDto, ctx)
                                                        │
                    ┌───────────────────────────────────┴───────────────────────────────────┐
                    │                                                                       │
                    │  ctx.topOfBook = {bid, ask, spread, midPrice, spreadPercent}         │
                    │                    ↑                                                  │
                    │                    │                                                  │
                    │              WebSocket temps réel ✅                                  │
                    │                                                                       │
                    │  marketDto.outcomePrices = [{outcome, price}, ...]                    │
                    │                    ↑                                                  │
                    │                    │                                                  │
                    │              Gamma API REST (cache 30s) ⚠️                            │
                    │                                                                       │
                    └───────────────────────────────────────────────────────────────────────┘
```

### 3.2 Problème du Cache Gamma

**Code dans `strategy-runner.ts` (lignes 43-58, 213-236):**

```typescript
const OUTCOME_PRICES_CACHE_TTL_MS = 30_000;  // 30 secondes

private async fetchGammaMarketCached(conditionId: string, now: number): Promise<GammaMarket | null> {
  const cached = this.gammaCache.get(conditionId);
  if (cached && now - cached.fetchedAt < OUTCOME_PRICES_CACHE_TTL_MS) {
    return cached.market;  // ⚠️ Retourne le cache sans vérifier
  }
  
  const market = await fetchGammaMarket(conditionId);
  this.gammaCache.set(conditionId, { market, fetchedAt: now });
  return market;
}
```

**Impact pour marchés 5min:**
- Un marché 5min peut bouger de 10%+ en 30 secondes
- Le cache retourne un prix qui n'est plus valide
- Le spread calculé est correct (WebSocket), mais le prix YES/NO est obsolète

**Le spread WebSocket aide-t-il?**
- `spread` = `ask - bid` (temps réel) ✅
- `midPrice` = `(bid + ask) / 2` (temps réel) ✅
- Mais `outcomePricesParsed` vient du cache Gamma ⚠️

**Solution possible:**
Le WebSocket fournit `midPrice` pour le token YES. On pourrait:
1. Utiliser `midPrice` du WebSocket au lieu de `outcomePricesParsed`
2. Ou forcer le refresh Gamma plus souvent pour marchés courts

---

## 4. Vérification par Point: Révision du Rapport Initial

### 4.1 Point P0: Mapping Outcome - **RÉVISÉ**

**Rapport initial:** "Convention `outcomePrices[0] = YES` non validée"  
**Vérification code:**

| Assertion | Vérification | Statut |
|-----------|--------------|--------|
| `prices[0]` = YES par convention | ✅ Confirmé par tests | ⚠️ Convention non validée dans stratégie |
| `mapOutcomeTokens` normalise `up/down` | ✅ Vérifié ligne 90-91 | ✅ Fonctionne |
| Fallback `pairs[0]` = YES | ✅ Vérifié ligne 95-96 | ✅ Cohérent |
| `tokenIdYes/No` disponibles | ✅ Vérifié dans `marketToListItemDto` | ✅ Disponibles |

**Conclusion:** Le mapping EST correct dans la pratique, mais **manque de validation explicite**.

**Correction nécessaire:**
```typescript
// Ajouter validation dans naive-momentum.strategy.ts
const prices = market.outcomePrices;
if (!prices || prices.length < 2) return null;

// Option A: Utiliser outcome label
const yesPrice = prices.find(p => 
  p.outcome.toLowerCase() === 'yes' || p.outcome.toLowerCase() === 'up'
)?.price;
const noPrice = prices.find(p => 
  p.outcome.toLowerCase() === 'no' || p.outcome.toLowerCase() === 'down'
)?.price;

// Option B: Valider que prices[0] = YES
if (prices[0]?.outcome?.toLowerCase() !== 'yes' && 
    prices[0]?.outcome?.toLowerCase() !== 'up') {
  log.warn({ outcomes: prices.map(p => p.outcome) }, 'Unexpected outcome order');
  return null;
}
const yesPrice = prices[0]?.price;
```

**Score révisé:** 8/10 (fonctionnel mais pourrait être plus robuste)

### 4.2 Point P1: Cache TTL - **CONFIRMÉ**

**Code actuel:** 30s pour tous les marchés  
**WebSocket fournit:** `midPrice` temps réel pour token YES/NO

**Amélioration possible:**
1. **Utiliser `midPrice` du WebSocket** (déjà disponible!) au lieu de `outcomePricesParsed`
2. Ou adapter TTL selon interval

**Score:** 6/10 (amélioration nécessaire)

### 4.3 Point P1: Spread Limit - **CONFIRMÉ**

**Code actuel:** `maxSpreadPercent: 5` fixe  
**Problème:** Marchés 5min ont souvent plus de spread naturel

**Amélioration possible:**
```typescript
// Spread dynamique selon interval
function getMaxSpreadForInterval(interval: string | null): number {
  if (!interval) return 5;
  if (['5m', '10m'].includes(interval)) return 10;
  if (['15m', '30m'].includes(interval)) return 7;
  return 5;
}
```

**Score:** 6/10 (amélioration nécessaire)

### 4.4 Point P1: Résolution Anticipée - **RÉVISÉ**

**Rapport initial:** "Pas de détection de résolution anticipée"  
**Code vérifié:**

```typescript
// price-feed.ts ligne 369-372
private handleMarketResolved(conditionId: string): void {
  log.info({ conditionId }, 'market resolved event received');
  this.onMarketResolved?.(conditionId);  // ✅ Callback déclenché
}

// strategy-runner.ts ligne 263-267
private async handleMarketResolved(conditionId: string): Promise<void> {
  log.info({ conditionId }, 'market resolved event — will be cleaned by janitor');
  // ⚠️ Juste log, pas d'action immédiate
}
```

**Problème:** L'event `market_resolved` est capté mais **pas traité immédiatement**.  
Le janitor tourne toutes les 60s pour désactiver.

**Amélioration possible:**
```typescript
private async handleMarketResolved(conditionId: string): Promise<void> {
  log.info({ conditionId }, 'market resolved event — immediate cleanup');
  
  // Désactiver immédiatement la sélection
  await this.algoSelectionService.setEnabled(conditionId, false);
  
  // Annuler tout ordre en attente pour ce marché
  // (si applicable)
}
```

**Score:** 7/10 (fonctionnel mais 60s de délai)

### 4.5 Point P2: Validation Interval - **CONFIRMÉ**

**Code actuel:** Aucune validation du format `interval`  
**Problème:** Si `interval` contient une valeur invalide, pas d'erreur

**Amélioration possible:**
```typescript
const VALID_INTERVALS = ['5m', '10m', '15m', '30m', '1h', '4h', '1d'] as const;

if (interval && !VALID_INTERVALS.includes(interval)) {
  throw new Error(`Invalid interval: ${interval}`);
}
```

**Score:** 7/10 (amélioration mineure)

---

## 5. Possibilité de Câblage sur WebSocket

### 5.1 Données Déjà Câblées ✅

| Donnée | WebSocket | Câblé | Utilisé |
|--------|-----------|-------|---------|
| `bid` | ✅ | ✅ | ✅ Spread calculation |
| `ask` | ✅ | ✅ | ✅ Spread calculation |
| `spread` | ✅ | ✅ | ✅ Filtrage spread limit |
| `midPrice` | ✅ | ✅ | ⚠️ Non utilisé directement |
| `market_resolved` | ✅ | ✅ | ⚠️ Log seulement |

### 5.2 Données Non Câblées (impossible via WebSocket)

| Donnée | Source WebSocket | Alternatives |
|--------|-----------------|--------------|
| `outcomePrices` | ❌ Non disponible | Gamma API REST ou calcul depuis midPrice |
| `winningTokenId` | ❌ Non disponible | Gamma API REST |
| `acceptingOrders` | ❌ Non disponible | Gamma API REST ou DB |

### 5.3 Optimisation Suggérée: Utiliser midPrice WebSocket

**Code actuel:**
```typescript
// naive-momentum.strategy.ts
const yesPrice = prices[0]?.price;  // Depuis Gamma cache (30s TTL)
const spreadPercent = ctx.topOfBook?.spreadPercent;  // Depuis WebSocket (temps réel)
```

**Optimisation possible:**
```typescript
// Utiliser midPrice du WebSocket comme approximation de YES price
const wsYesMidPrice = ctx.topOfBook?.midPrice;  // Temps réel

// Fallback vers Gamma si WebSocket non disponible
const yesPrice = wsYesMidPrice ?? prices[0]?.price;

// Avantages:
// 1. Prix temps réel (pas de cache 30s)
// 2. Plus réactif pour marchés 5min
// 3. Pas de requête Gamma pour le prix
```

**⚠️ Attention:**
- `midPrice` = `(bid + ask) / 2` n'est pas exactement le "true price" YES
- Pour les marchés avec spread, le midPrice est entre bid et ask
- Le "true YES probability" est souvent proche du midPrice, mais peut différer

**Validation:**
```typescript
// Comparer midPrice vs outcomePrices[0].price pour validation
const gammaYesPrice = prices[0]?.price;
const wsMidPrice = ctx.topOfBook?.midPrice;

if (gammaYesPrice && wsMidPrice) {
  const deviation = Math.abs(gammaYesPrice - wsMidPrice);
  if (deviation > 0.05) {  // >5% de déviation
    log.warn({ gammaYesPrice, wsMidPrice, deviation }, 
      'Significant price deviation between Gamma and WebSocket');
    // Peut indiquer un problème de synchronisation
  }
}
```

---

## 6. Résumé des Points Corrigibles

### 6.1 Priorité P0 - Correction Immédiate

| Problème | Sévérité | Effort | Impact |
|----------|----------|--------|--------|
| Validation mapping outcome | ⚠️ MOYENNE | Faible | Évite trading inversé |

**Correction:**
```typescript
// Dans naive-momentum.strategy.ts
const yesOutcome = prices.find(p => 
  ['yes', 'up'].includes(p.outcome.toLowerCase())
);
const noOutcome = prices.find(p => 
  ['no', 'down'].includes(p.outcome.toLowerCase())
);

if (!yesOutcome || !noOutcome) {
  log.warn({ outcomes: prices.map(p => p.outcome) }, 'Cannot identify YES/NO outcomes');
  return null;
}

// Validation: YES + NO ≈ 1.00
const sum = yesOutcome.price + noOutcome.price;
if (Math.abs(sum - 1.0) > 0.02) {
  log.warn({ yesPrice: yesOutcome.price, noPrice: noOutcome.price, sum },
    'Invalid outcome prices: sum should be ~1.0');
  return null;
}

const yesPrice = yesOutcome.price;
```

### 6.2 Priorité P1 - Optimisation

| Problème | Sévérité | Effort | Impact |
|----------|----------|--------|--------|
| Utiliser midPrice WebSocket | ⚠️ MOYENNE | Moyen | Prix temps réel pour marchés courts |
| Spread limit dynamique | ⚠️ MOYENNE | Faible | Plus de signaux sur marchés courts |
| Cache TTL adaptatif | ⚠️ BASSE | Faible | Moins de requêtes Gamma |

**Optimisation prix temps réel:**
```typescript
// Utiliser WebSocket midPrice comme proxy pour YES price
// quand disponible et validé
const wsMidPrice = ctx.topOfBook?.midPrice;
const gammaYesPrice = prices[0]?.price;

let yesPrice: number;
if (wsMidPrice !== null && gammaYesPrice !== undefined) {
  // Vérifier cohérence
  const deviation = Math.abs(wsMidPrice - gammaYesPrice);
  if (deviation < 0.05) {
    // Moins de 5% de déviation: utiliser WebSocket (plus frais)
    yesPrice = wsMidPrice;
  } else {
    // Déviation significative: utiliser Gamma (plus fiable)
    yesPrice = gammaYesPrice;
    log.debug({ wsMidPrice, gammaYesPrice, deviation }, 
      'Using Gamma price due to deviation');
  }
} else {
  yesPrice = gammaYesPrice ?? 0.5;
}
```

### 6.3 Priorité P2 - Améliorations Mineures

| Problème | Sévérité | Effort | Impact |
|----------|----------|--------|--------|
| Validation format interval | ⚠️ BASSE | Faible | Données propres |
| Traitement immédiat market_resolved | ⚠Ë BASSE | Moyen | Réactivité accrue |

---

## 7. Conclusion Révisée

### 7.1 Ce Qui Fonctionne Bien ✅

| Aspect | Évaluation | Commentaire |
|--------|------------|-------------|
| Lifecycle checks (endDate, resolved, closed) | ✅ **ROBUSTE** | Vérifications avant chaque signal |
| Janitor cleanup | ✅ **FONCTIONNEL** | Désactive les marchés résolus en 60s |
| WebSocket real-time pricing | ✅ **BIEN CÂBLÉ** | bid/ask/spread temps réel |
| Re-entry protection | ✅ **PROTÈGE** | 1 signal/conditionId/heure |
| Outcome mapping | ✅ **CORRECT** | Gère yes/no et up/down |
| Fallback mapping | ✅ **FONCTIONNEL** | pairs[0]=YES, pairs[1]=NO |

### 7.2 Points à Améliorer ⚠️

| Problème | Priorité | Impact | WebSocket Câblable? |
|----------|----------|--------|---------------------|
| Validation explicite YES/NO | **P0** | HAUT | ❌ Pas besoin (déjà disponible) |
| Cache Gamma 30s pour 5min | **P1** | MOYEN | ✅ **OUI** - utiliser midPrice |
| Spread limit 5% fixe | **P1** | MOYEN | ❌ Configuration |
| Traitement market_resolved | **P2** | BAS | ✅ **DÉJÀ CÂBLÉ** - améliorer handler |
| Validation interval | **P2** | BAS | ❌ Configuration |

### 7.3 Score Global Révisé

**Score de robustesse: 8/10** (révisé depuis 7.5/10)

**Points forts:**
- Mapping outcome gère `yes/no` et `up/down` ✅
- WebSocket fournit temps réel ✅
- Lifecycle checks robustes ✅

**Points à améliorer:**
- Validation explicite du mapping (ajouter logs/warnings)
- Utiliser midPrice WebSocket au lieu de cache Gamma pour marchés courts
- Spread limit dynamique

### 7.4 Recommandation Prioritaire

1. **P0 (immédiat):** Ajouter validation explicite YES/NO dans stratégie + validation sum ≈ 1.0
2. **P1 (1-2 semaines):** Utiliser midPrice WebSocket comme proxy pour YES price
3. **P1 (1-2 semaines):** Paramétrer spread max dynamique selon interval
4. **P2 (1 mois):** Améliorer handler market_resolved pour désactivation immédiate

---

## 8. Annexes: Code à Modifier

### 8.1 Validation Explicite (P0)

```typescript
// packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts

async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  const prices = market.outcomePrices;
  if (!prices || prices.length < 2) return null;

  // ✅ NOUVEAU: Trouver YES et NO par outcome label
  const yesOutcome = prices.find(p => 
    ['yes', 'up'].includes(p.outcome.toLowerCase())
  );
  const noOutcome = prices.find(p => 
    ['no', 'down'].includes(p.outcome.toLowerCase())
  );

  // ✅ NOUVEAU: Validation
  if (!yesOutcome || !noOutcome) {
    log.warn(
      { conditionId: market.conditionId, outcomes: prices.map(p => p.outcome) },
      'Cannot identify YES/NO outcomes from outcomePrices'
    );
    return null;
  }

  // ✅ NOUVEAU: Validation sum ≈ 1.0
  const sum = yesOutcome.price + noOutcome.price;
  if (Math.abs(sum - 1.0) > 0.02) {
    log.warn(
      { conditionId: market.conditionId, yesPrice: yesOutcome.price, noPrice: noOutcome.price, sum },
      'Invalid outcome prices: sum should be ~1.0'
    );
    return null;
  }

  const yesPrice = yesOutcome.price;
  
  // ... reste de la logique
}
```

### 8.2 Utiliser midPrice WebSocket (P1)

```typescript
// packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts

async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  // ... validation YES/NO ...

  // ✅ NOUVEAU: Préférer WebSocket midPrice si disponible
  const wsMidPrice = ctx.topOfBook?.midPrice;
  const gammaYesPrice = yesOutcome.price;

  let yesPrice: number;
  if (wsMidPrice !== null && wsMidPrice !== undefined) {
    // Vérifier cohérence entre WebSocket et Gamma
    const deviation = Math.abs(wsMidPrice - gammaYesPrice);
    if (deviation < 0.05) {
      // Moins de 5% de déviation: utiliser WebSocket (plus frais)
      yesPrice = wsMidPrice;
    } else {
      // Déviation significative: utiliser Gamma
      yesPrice = gammaYesPrice;
    }
  } else {
    yesPrice = gammaYesPrice;
  }

  // ... reste de la logique
}
```

---

**Rapport révisé par PMA - Project Manager Agent**  
**Version:** 2.0  
**Approbation requise:** Tech Lead + Product Owner