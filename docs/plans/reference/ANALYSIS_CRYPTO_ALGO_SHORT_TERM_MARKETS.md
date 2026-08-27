# Analyse Crypto-Algo: Gestion des Marchés Court Terme (Up/Down 5min)

> **Note historique (resync 2026-08-07)** : snapshot d'analyse (2025-01). Comportement actuel : [`docs/code/07-crypto-algo.md`](../../code/07-crypto-algo.md), [`docs/reference/crypto-algo.md`](../../reference/crypto-algo.md). Constantes `OUTCOME_PRICES_CACHE_TTL_*` / `RE_ENTRY_WINDOW_MS` supprimées (`6d99017`).

**Date:** 2025-01-27  
**Auteur:** PMA (Project Manager Agent)  
**Scope:** Package `@polywatch/crypto-algo` - Stratégies algorithmiques sur marchés crypto up/down

---

## 1. Architecture Actuelle

### 1.1 Flux de Données

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CRYPTO-ALGO DATA FLOW                                  │
└─────────────────────────────────────────────────────────────────────────┘

SelectionLoader          StrategyRunner                  EntryPipeline
     │                        │                               │
     ├─ loadAllEnabled()      │                               │
     │                        │                               │
     ▼                        ▼                               ▼
┌──────────┐           ┌──────────────┐              ┌─────────────────┐
│ Database │           │ PriceFeed    │              │ Reservation     │
│  - AMS   │           │  (WebSocket) │              │  Service        │
└──────────┘           └──────────────┘              └─────────────────┘
     │                        │                               │
     │                        │                               │
     ▼                        ▼                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    Market Lifecycle Checks                              │
│  - endDate < now ?  → SKIP                                             │
│  - acceptingOrders = false ? → SKIP                                     │
│  - resolved = true ? → SKIP                                             │
│  - closed = true ?  → SKIP                                              │
└────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ Strategy.evaluate │
                    │  - NaiveMomentum  │
                    │  - YES/NO decision │
                    └───────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ AlgoSignal        │
                    │  - conditionId    │
                    │  - assetId        │
                    │  - outcome: YES/NO│
                    │  - interval       │
                    └───────────────────┘
```

### 1.2 Entité `AlgoMarketSelection`

```typescript
// packages/core/src/entities/AlgoMarketSelection.ts
{
  id: number;
  conditionId: string;       // Polymarket condition ID
  question?: string | null;  // Question du marché (ex: "BTC up 5min?")
  cryptoSymbol?: string | null;  // Ex: "BTC", "ETH"
  interval?: string | null;  // Ex: "5m", "10m", "1h"
  slug?: string | null;      // Market slug
  enabled: boolean;          // Actif/inactif
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 2. Gestion des Outcomes

### 2.1 Structure des Outcomes Polymarket

Les marchés Polymarket ont **toujours** deux outcomes:
- **Outcome YES** (`tokenIdYes`): Token représentant "Oui"
- **Outcome NO** (`tokenIdNo`): Token représentant "Non"

**Convention critique:**
```typescript
// packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts
const prices = market.outcomePrices;
const yesPrice = prices[0]?.price;  // ⚠️ Convention non documentée
```

### 2.2 Mapping Winning Outcome

```typescript
// packages/core/src/polymarket/redemption.ts
export function resolveWinningOutcome(
  winningTokenId: string,
  tokenIdYes: string | null,
  tokenIdNo: string | null,
): 'YES' | 'NO' | null {
  if (winningTokenId === tokenIdYes) return 'YES';
  if (winningTokenId === tokenIdNo) return 'NO';
  return null;
}
```

### 2.3 Flux de Résolution

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    RESOLUTION FLOW                                       │
└─────────────────────────────────────────────────────────────────────────┘

1. Market expires OR resolves early
      │
      ▼
2. MarketResolutionWatcher (30s poll)
      │ detect resolved/winningTokenId
      ▼
3. CopiedPosition.status → 'pending_resolution'
      │
      ▼
4. RedemptionHandler (15s poll)
      │ loadPendingResolution()
      ▼
5. Resolve winning outcome
      │ winningTokenId === tokenIdYes ? YES : NO
      ▼
6. On-chain redemption (real mode) or cash settlement (sim mode)
      │
      ▼
7. Position closed, payoff credited
```

---

## 3. Gestion des Marchés Court Terme (5min, 10min, 1h)

### 3.1 Points Bien Gérés ✅

#### 3.1.1 Désactivation Automatique (Janitor)

```typescript
// packages/crypto-algo/src/strategy/strategy-runner.ts
async startJanitor(): NodeJS.Timeout {
  this.janitorTimer = safeInterval(
    async () => {
      const disabled = await this.algoSelectionService.disableResolved();
      // Désactive les marchés:
      // - resolved = true
      // - closed = true
      // - endDate < now
    },
    60_000,  // Toutes les 60 secondes
  );
}
```

**Avantage:** Les marchés courts (5min) ne restent pas actifs après expiration.

#### 3.1.2 Cache Court pour Gamma API

```typescript
// packages/crypto-algo/src/strategy/strategy-runner.ts
const OUTCOME_PRICES_CACHE_TTL_MS = 30_000;  // 30 secondes
```

**Avantage:** Prix frais pour marchés volatils, mais...

#### 3.1.3 WebSocket Real-Time

```typescript
// packages/crypto-algo/src/price-feed.ts
setOnPriceUpdate((conditionId, assetId, topOfBook) => {
  this.handlePriceUpdate(conditionId, assetId, topOfBook);
});

// Déclenchement immédiat sur changement de prix
// avec débounce de 5s pour éviter sur-évaluation
```

**Avantage:** Réactivité temps réel pour marchés rapides.

#### 3.1.4 Protection Re-entry

```typescript
const RE_ENTRY_WINDOW_MS = 60 * 60 * 1000;  // 1 heure
const MAX_ENTRIES_PER_WINDOW = 1;
// Un signal par conditionId par heure maximum
```

**Avantage:** Évite surtrade sur même marché.

#### 3.1.5 Vérifications Pre-Entry

```typescript
// packages/crypto-algo/src/strategy/strategy-runner.ts
if (market.endDate && market.endDate < now) return;
if (market.acceptingOrders === false) return;
if (market.resolved || market.closed) return;
```

**Avantage:** N'entre pas dans marché expiré.

### 3.2 Points Critiques à Améliorer ⚠️

#### 3.2.1 ⚠️ CRITIQUE: Convention `outcomePrices[0] = YES` Non Vérifiée

**Problème:**
```typescript
// naive-momentum.strategy.ts:84
const yesPrice = prices[0]?.price;
// ⚠️ Suppose que prices[0] est toujours YES
// ⚠️ Pas de vérification que prices[1] est NO
// ⚠️ Pas de mapping explicite tokenId → outcome
```

**Risques:**
1. Si l'ordre change dans l'API Gamma, la stratégie trade le mauvais côté
2. Markets courts peuvent avoir structures différentes
3. Pas de validation croisée avec `tokenIdYes` / `tokenIdNo`

**Impact:** **HAUT** - Signal inversé = perte immédiate

**Recommandation:**
```typescript
// Vérification explicite
const yesTokenId = market.tokenIdYes;
const noTokenId = market.tokenIdNo;

const yesOutcome = market.outcomePrices.find(
  p => p.assetId === yesTokenId || p.tokenId === yesTokenId
);
const noOutcome = market.outcomePrices.find(
  p => p.assetId === noTokenId || p.tokenId === noTokenId
);

if (!yesOutcome || !noOutcome) {
  log.warn('Could not map outcomes to YES/NO tokens');
  return null;
}

const yesPrice = yesOutcome.price;
```

#### 3.2.2 ⚠️ MODÉRÉ: Cache Gamma Potentiellement Périmé

**Problème:**
```typescript
OUTCOME_PRICES_CACHE_TTL_MS = 30_000;  // 30 secondes

// Pour un marché 5min avec mouvement rapide:
// T0:   YES = 0.55 (détecté)
// T+30: YES = 0.75 (non vu car cache)
// → Signal basé sur prix obsolète
```

**Risques:**
1. Entrée à prix défavorable après mouvement
2. Spread calculé incorrect
3. Confiance surévaluée

**Impact:** **MOYEN** - Slippage, mauvais timing

**Recommandation:**
- Pour marchés courts (`interval: '5m'`), TTL ≤ 10s
- Forcer refresh via WebSocket `market_resolved` event
- Implémenter cache invalidation sur `endDate` proche

#### 3.2.3 ⚠️ MODÉRÉ: Spread Limit 5% Peut-Être Trop Restrictif

**Problème:**
```typescript
// naive-momentum.strategy.ts
maxSpreadPercent: 5,  // 5% max

// Les marchés courts peuvent avoir:
// - Spread naturel plus élevé (volatilité)
// - Moins de liquidité
// → Stratégie peut ne jamais signer
```

**Impact:** **MOYEN** - Opportunités manquées

**Recommandation:**
- Paramétrage dynamique par `interval`
- 5m: spread max 8-10%
- 1h: spread max 5%
- Ajuster selon liquidité observée

#### 3.2.4 ⚠️ BASSE: Pas de Détection de Résolution Anticipée

**Problème:**
```typescript
// Les marchés courts peuvent résoudre AVANT endDate si:
// - Le prix atteint une cible prédéfinie
// - L'événement se produit (ex: BTC tape $X)
// - Oracles/clôture automatique

// Actuellement, on attend endDate ou resolved=true
```

**Impact:** **BAS** - Le janitor 60s détecte `resolved=true`

**Note:** Polymarket peut résoudre un marché court-term immédiatement si l'outcome est déterminé. Le système le détecte via:
```typescript
// strategy-runner.ts
if (market.resolved || market.closed) return;
```

Mais il y a une fenêtre de 60s max avant désactivation.

#### 3.2.5 ⚠️ BASSE: Aucune Validation du Format `interval`

**Problème:**
```typescript
// AlgoMarketSelection.interval est string | null
// Pas de validation que c'est "5m", "10m", "1h", etc.
// Pas de logique métier selon interval
```

**Impact:** **BAS** - Données mal formatées ignorées silencieusement

**Recommandation:**
```typescript
// Ajouter validation
const VALID_INTERVALS = ['5m', '10m', '15m', '30m', '1h', '4h', '1d'];

if (!VALID_INTERVALS.includes(interval)) {
  throw new Error(`Invalid interval: ${interval}`);
}
```

---

## 4. Comparaison avec Documentation Polymarket

### 4.1 Spécifications Polymarket

#### Market Structure
```
{
  "conditionId": "0x...",
  "question": "Will BTC be above $X at Y?",
  "outcomes": ["Yes", "No"],
  "outcomePrices": ["0.65", "0.35"],
  "clobTokenIds": ["tokenIdYes", "tokenIdNo"],
  "endDate": "2024-01-27T12:05:00Z",
  "resolved": false,
  "winningTokenId": null
}
```

#### Résolution
- Market expire → `endDate` passé
- Résolution → `resolved=true`, `winningTokenId` set
- Oracles peuvent résoudre avant `endDate`
- Short-term markets peuvent avoir clôture automatique

#### Order Books
- `acceptingOrders=true`: Market ouvert
- `acceptingOrders=false`: Market fermé (pré-résolution)
- `closed=true`: Market complètement fermé

### 4.2 Alignement du Code

| Aspect | Polymarket Spec | Code Actuel | Statut |
|--------|----------------|-------------|--------|
| Deux outcomes (YES/NO) | ✅ | ✅ Géré via `tokenIdYes/No` | ✅ Aligné |
| Prix outcomes ordre fixe | Non garanti | ⚠️ Suppose `[0]=YES` | ⚠️ Risqué |
| endDate comme expiration | ✅ | ✅ Vérifié avant entry | ✅ Aligné |
| acceptingOrders flag | ✅ | ✅ Vérifié | ✅ Aligné |
| Resolution detection | ✅ | ✅ Via janitor + WebSocket | ✅ Aligné |
| winningTokenId mapping | ✅ | ✅ `resolveWinningOutcome()` | ✅ Aligné |
| Cache pricing | N/A | ⚠️ 30s TTL | ⚠️ Court pour 5m |

---

## 5. Recommandations Priorisées

### 5.1 P0 - Critique (À Corriger Immédiatement)

#### 5.1.1 Validation Explicite du Mapping Outcome

```typescript
// packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts

async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  // ✅ VALIDATION EXPLICITE
  const tokenIdYes = market.tokenIdYes;
  const tokenIdNo = market.tokenIdNo;
  
  if (!tokenIdYes || !tokenIdNo) {
    log.warn({ conditionId: market.conditionId }, 'Market missing YES/NO token IDs');
    return null;
  }
  
  const prices = market.outcomePrices;
  if (!prices || prices.length < 2) {
    return null;
  }
  
  // ✅ Mapping robuste au lieu de supposer l'ordre
  const yesPrice = prices.find(p => 
    p.tokenId === tokenIdYes || p.assetId === tokenIdYes
  )?.price;
  
  const noPrice = prices.find(p => 
    p.tokenId === tokenIdNo || p.assetId === tokenIdNo
  )?.price;
  
  if (yesPrice === undefined || noPrice === undefined) {
    log.warn(
      { conditionId: market.conditionId, tokenIdYes, tokenIdNo, prices },
      'Could not map outcome prices to YES/NO tokens'
    );
    return null;
  }
  
  // Validation: YES + NO ≈ 1.00 (± 0.02 pour spread/fees)
  const sum = yesPrice + noPrice;
  if (Math.abs(sum - 1.0) > 0.02) {
    log.warn(
      { conditionId: market.conditionId, yesPrice, noPrice, sum },
      'Invalid outcome prices: sum should be ~1.0'
    );
    return null;
  }
  
  // ... reste de la logique
}
```

### 5.2 P1 - Élevé (À Corriger Prochainement)

#### 5.2.1 Cache TTL Adaptatif par Interval

```typescript
// packages/crypto-algo/src/strategy/strategy-runner.ts

function getCacheTtlForInterval(interval: string | null): number {
  if (!interval) return 30_000;  // Default
  
  switch (interval) {
    case '5m':
    case '10m':
      return 10_000;  // 10s pour courts-termes
    case '15m':
    case '30m':
      return 20_000;  // 20s pour moyen-termes
    case '1h':
    case '4h':
    case '1d':
    default:
      return 30_000;  // 30s pour long-termes
  }
}

// Utiliser dans fetchGammaMarketCached
private async fetchGammaMarketCached(
  conditionId: string,
  now: number,
  interval: string | null,
): Promise<GammaMarket | null> {
  const cached = this.gammaCache.get(conditionId);
  const ttl = getCacheTtlForInterval(interval);
  
  if (cached && now - cached.fetchedAt < ttl) {
    return cached.market;
  }
  // ...
}
```

#### 5.2.2 Spread Limit Dynamique par Interval

```typescript
// packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts

export interface NaiveMomentumConfig {
  baseThreshold: number;
  maxSpreadPercent: number;  // Maintenant dynamique
  spreadAdjustmentFactor: number;
  minSpreadForAdjustment: number;
}

function getMaxSpreadForInterval(interval: string | null): number {
  if (!interval) return 5;
  
  // Marchés courts = plus de volatilité = spread plus large acceptable
  if (['5m', '10m'].includes(interval)) return 10;
  if (['15m', '30m'].includes(interval)) return 7;
  return 5;  // 1h+
}

async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  const maxSpread = getMaxSpreadForInterval(market.interval);
  
  if (spreadPercent !== null && spreadPercent > maxSpread) {
    return null;
  }
  
  // ...
}
```

### 5.3 P2 - Modéré (À Planifier)

#### 5.3.1 Validation du Format Interval

```typescript
// packages/core/src/services/algo-market-selection.service.ts

const VALID_INTERVALS = ['5m', '10m', '15m', '30m', '1h', '4h', '1d'] as const;
type ValidInterval = typeof VALID_INTERVALS[number];

async addSelection(
  conditionId: string,
  meta: AlgoSelectionMeta,
): Promise<AlgoMarketSelection> {
  if (meta.interval && !VALID_INTERVALS.includes(meta.interval as ValidInterval)) {
    throw new Error(
      `Invalid interval "${meta.interval}". Must be one of: ${VALID_INTERVALS.join(', ')}`
    );
  }
  // ...
}
```

#### 5.3.2 Monitoring des Résolutions Anticipées

```typescript
// Ajouter dans strategy-runner.ts

// Log quand un marché est désactivé avant endDate
async checkEarlyResolution(market: Market, selection: AlgoMarketSelection): Promise<void> {
  if (market.resolved && market.endDate && new Date() < market.endDate) {
    log.info(
      {
        conditionId: market.conditionId,
        interval: selection.interval,
        endDate: market.endDate,
        resolvedAt: new Date(),
      },
      'Market resolved before endDate (early resolution detected)'
    );
  }
}
```

---

## 6. Gaps Identifiés vs Polymarket

### 6.1 Points Manquants

1. **Pas de gestion des "Multi-Crypto Markets"**
   - Polymarket peut avoir des marchés "BTC or ETH up?"
   - Plus de 2 outcomes possibles (bien que rare)
   - Code suppose TOUJOURS 2 outcomes (YES/NO)

2. **Pas de distinction entre "Up" et "Down"**
   - `cryptoSymbol` stocké mais pas utilisé dans la logique
   - Pas de tracking directionnel (bullish/bearish)
   - Interval stocké mais pas exploité

3. **Pas de gestion des marchés "Negative Risk"**
   - Polymarket a des marchés avec mécanisme spécial
   - Code non documenté pour `negRisk`

### 6.2 Points À Surveiller

1. **WebSocket `market_resolved` Event**
   - Le code capte l'event mais ne réagit pas immédiatement
   - Attend le janitor 60s pour désactiver
   - Amélioration: réagir immédiatement au lieu de poll

2. **Cache Invalidation sur Résolution**
   - Cache Gamma pas invalidé quand marché résout
   - Risque d'utiliser prix obsolète pendant 30s

3. **Race Condition Possible**
   - Market peut résoudre entre signal et exécution
   - Pas de vérification atomic `acceptingOrders` au moment de l'ordre

---

## 7. Conclusion

### 7.1 Ce Qui Fonctionne Bien ✅

| Aspect | Évaluation |
|--------|------------|
| Lifecycle checks (endDate, resolved, closed) | ✅ Robuste |
| Janitor cleanup (désactivation auto) | ✅ Fonctionnel |
| WebSocket real-time pricing | ✅ Bonne réactivité |
| Re-entry protection (1 sig/heure) | ✅ Protection contre surtrade |
| Resolution flow (winning outcome mapping) | ✅ Correct |
| Redemption handling (on-chain) | ✅ Aligné avec Polymarket |

### 7.2 Points Critiques à Corriger ⚠️

| Problème | Priorité | Impact | Effort |
|----------|----------|--------|--------|
| Mapping outcomePrices non validé | **P0** | HAUT | Moyen |
| Cache TTL 30s pour marchés 5min | **P1** | MOYEN | Faible |
| Spread 5% trop restrictif | **P1** | MOYEN | Faible |
| Pas de validation interval | **P2** | BAS | Faible |

### 7.3 Score Global

**Score de robustesse: 7.5/10**

- ✅ Architecture bien pensée
- ✅ Lifecycle management correct
- ⚠️ Validation mapping outcome critique
- ⚠️ Cache TTL à adapter
- ✅ Protection contre surtrade

**Recommandation principale:** Corriger le mapping outcomePrices en P0 avant de trader sur marchés réels.

---

## 8. Prochaines Étapes

1. **Immédiat (P0)**
   - [ ] Implémenter validation explicite YES/NO token IDs
   - [ ] Ajouter tests unitaires pour mapping outcome
   - [ ] Vérifier sum(yesPrice + noPrice) ≈ 1.0

2. **Court terme (P1) - 1-2 semaines**
   - [ ] Adapter TTL cache selon interval
   - [ ] Paramétrer spread max dynamique
   - [ ] Ajouter métriques sur early resolutions

3. **Moyen terme (P2) - 1 mois**
   - [ ] Validation format interval
   - [ ] Monitoring résolutions anticipées
   - [ ] Tests d'intégration avec vrais marchés 5min

4. **Long terme**
   - [ ] Support marchés multi-outcomes
   - [ ] Tracking directionnel (up/down)
   - [ ] Stratégies spécialisées par interval

---

**Rapport généré par PMA - Project Manager Agent**  
**Révision:** v1.0  
**Approbation requise:** Tech Lead + Product Owner