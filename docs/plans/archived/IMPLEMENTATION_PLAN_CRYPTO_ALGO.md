# Plan d'Implémentation: Crypto-Algo Court Terme
## Corrections et Optimisations pour Marchés Up/Down 5min

> **Note historique (resync 2026-08-07)** : plan d'implémentation antérieur. Référence runtime : [`docs/code/07-crypto-algo.md`](../code/07-crypto-algo.md). Snippets `OUTCOME_PRICES_CACHE_TTL_MS` obsolètes.

**Date:** 2025-01-27  
**Projet:** Polywatch v1 - Package `@polywatch/crypto-algo`  
**Priorité:** P0 → P2  
**Effort estimé:** 3-5 jours  

---

## Vue d'Ensemble

| Phase | Priorité | Tâches | Effort | Impact |
|-------|----------|--------|--------|--------|
| **Phase 1** | P0 | Validation explicite outcomes | 0.5 jour | HAUT |
| **Phase 2** | P1 | Prix temps réel via WebSocket | 1 jour | MOYEN |
| **Phase 3** | P1 | Spread dynamique + TTL adaptatif | 0.5 jour | MOYEN |
| **Phase 4** | P2 | Handler résolution immédiate | 0.5 jour | BAS |
| **Phase 5** | P2 | Validation interval + tests | 0.5 jour | BAS |

**Total estimé:** 3 jours de développement

---

## Phase 1: Validation Explicite Outcomes (P0)

### Objectif
Garantir que le mapping YES/NO est correct avant de générer un signal.

### Fichiers à modifier
- `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts`
- `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.test.ts`

### Tâches

#### 1.1 Ajouter validation explicite YES/NO

```typescript
// Fichier: naive-momentum.strategy.ts
// Ajouter après ligne 80

async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  const prices = market.outcomePrices;
  if (!prices || prices.length < 2) return null;

  // NOUVEAU: Trouver YES et NO par outcome label (au lieu de prices[0])
  const yesOutcome = prices.find(p => 
    ['yes', 'up'].includes(p.outcome.toLowerCase())
  );
  const noOutcome = prices.find(p => 
    ['no', 'down'].includes(p.outcome.toLowerCase())
  );

  // NOUVEAU: Validation des outcomes
  if (!yesOutcome || !noOutcome) {
    this.log.warn(
      { conditionId: market.conditionId, outcomes: prices.map(p => p.outcome) },
      'Cannot identify YES/NO outcomes'
    );
    return null;
  }

  // NOUVEAU: Validation sum ≈ 1.0
  const sum = yesOutcome.price + noOutcome.price;
  if (Math.abs(sum - 1.0) > 0.02) {
    this.log.warn(
      { conditionId: market.conditionId, yesPrice: yesOutcome.price, noPrice: noOutcome.price, sum },
      'Invalid outcome prices: sum should be ~1.0'
    );
    return null;
  }

  const yesPrice = yesOutcome.price;
  // ... suite du code existant
}
```

#### 1.2 Ajouter logger à la classe

```typescript
// Fichier: naive-momentum.strategy.ts
// Ajouter après ligne 68

export class NaiveMomentumStrategy implements CryptoAlgoStrategy {
  readonly id = 'naive-momentum';
  private readonly config: NaiveMomentumConfig;
  private readonly log = pino({ name: 'crypto-algo:naive-momentum' });  // NOUVEAU

  constructor(config: Partial<NaiveMomentumConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  // ...
}
```

#### 1.3 Tests unitaires

```typescript
// Fichier: naive-momentum.strategy.test.ts
// Ajouter nouveaux tests

describe('Outcome validation', () => {
  it('recognizes "Up" and "Down" outcomes', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Up', price: 0.70 },
        { outcome: 'Down', price: 0.30 },
      ],
    });
    const result = await strategy.evaluate(market, { now: new Date() });
    expect(result).not.toBeNull();
    expect(result?.outcome).toBe('YES');
  });

  it('rejects when outcomes sum deviates from 1.0', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.75 },
        { outcome: 'No', price: 0.35 },  // Sum = 1.10 > 1.02 threshold
      ],
    });
    const result = await strategy.evaluate(market, { now: new Date() });
    expect(result).toBeNull();
  });

  it('rejects when outcomes cannot be identified', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Maybe', price: 0.50 },
        { outcome: 'Uncertain', price: 0.50 },
      ],
    });
    const result = await strategy.evaluate(market, { now: new Date() });
    expect(result).toBeNull();
  });
});
```

### Critères d'acceptation
- [ ] Tous les tests passent
- [ ] Validation YES/NO par label (pas par index)
- [ ] Validation sum ≈ 1.0 avec tolérance 2%
- [ ] Logs warning pour outcomes invalides

---

## Phase 2: Prix Temps Réel via WebSocket (P1)

### Objectif
Utiliser le `midPrice` du WebSocket comme prix YES temps réel au lieu du cache Gamma 30s.

### Fichiers à modifier
- `packages/crypto-algo/src/strategy/strategy-runner.ts`
- `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts`
- `packages/crypto-algo/src/price-feed.ts`

### Tâches

#### 2.1 Exposer midPrice YES depuis PriceFeed

```typescript
// Fichier: price-feed.ts
// Ajouter méthode getYesMidPrice

/**
 * Get the mid price for YES token from WebSocket data.
 * Returns null if not available or if spread exceeds threshold.
 */
getYesMidPrice(conditionId: string): number | null {
  const assets = this.conditionToAssets.get(conditionId);
  if (!assets?.tokenIdYes) return null;

  const topOfBook = this.topOfBook.get(assets.tokenIdYes);
  if (!topOfBook) return null;

  // Validation: spread acceptable
  if (topOfBook.spreadPercent > 10) return null;  // Trop de spread = prix non fiable

  return topOfBook.midPrice;
}
```

#### 2.2 Passer midPrice au contexte stratégie

```typescript
// Fichier: strategy-runner.ts
// Modifier evaluateSelection

private async evaluateSelection(
  selection: AlgoMarketSelection,
  topOfBook: TopOfBook | null,
): Promise<{ signal: AlgoSignal; strategy: CryptoAlgoStrategy } | null> {
  // ... code existant ...

  const gammaMarket = await this.fetchGammaMarketCached(selection.conditionId, now);
  
  // NOUVEAU: Obtenir midPrice YES depuis WebSocket
  const wsYesMidPrice = this.priceFeed.getYesMidPrice(selection.conditionId);

  const marketDto: MarketListItemDto = {
    // ... champs existants ...
    // Les outcomePrices restent disponibles (Gamma)
  };

  // NOUVEAU: Contexte enrichi avec prix WebSocket
  const ctx: StrategyContext = {
    now,
    topOfBook: topOfBook ?? undefined,
    wsYesMidPrice,  // NOUVEAU
  };

  // ... suite du code ...
}
```

#### 2.3 Modifier l'interface StrategyContext

```typescript
// Fichier: packages/crypto-algo/src/strategy/strategy.ts

export interface StrategyContext {
  now: Date;
  /** Top of book data from WebSocket (real-time). */
  topOfBook?: TopOfBook;
  /** NOUVEAU: Mid price for YES token from WebSocket (real-time). */
  wsYesMidPrice?: number | null;
}
```

#### 2.4 Utiliser wsYesMidPrice dans la stratégie

```typescript
// Fichier: naive-momentum.strategy.ts
// Modifier evaluate

async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  // ... validation outcomes ...

  const gammaYesPrice = yesOutcome.price;
  const wsMidPrice = ctx.wsYesMidPrice;

  // NOUVEAU: Choisir la source de prix
  let yesPrice: number;
  
  if (wsMidPrice !== null && wsMidPrice !== undefined) {
    // Vérifier cohérence entre sources
    const deviation = Math.abs(wsMidPrice - gammaYesPrice);
    
    if (deviation < 0.05) {
      // Moins de 5% de déviation: utiliser WebSocket (temps réel)
      yesPrice = wsMidPrice;
      this.log.debug({ conditionId: market.conditionId, wsMidPrice, gammaYesPrice },
        'Using WebSocket midPrice for YES');
    } else {
      // Déviation significative: utiliser Gamma (plus fiable)
      yesPrice = gammaYesPrice;
      this.log.warn({ conditionId: market.conditionId, wsMidPrice, gammaYesPrice, deviation },
        'Significant price deviation, using Gamma price');
    }
  } else {
    // WebSocket non disponible: fallback vers Gamma
    yesPrice = gammaYesPrice;
  }

  // ... suite de la logique existante ...
}
```

#### 2.5 Tests unitaires

```typescript
// Fichier: naive-momentum.strategy.test.ts
// Ajouter tests

describe('WebSocket price integration', () => {
  it('uses wsYesMidPrice when available and consistent', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const ctx = { now: new Date(), wsYesMidPrice: 0.66 };  // < 5% deviation
    const result = await strategy.evaluate(market, ctx);
    
    expect(result).not.toBeNull();
    // La stratégie utilise wsYesMidPrice (0.66) au lieu de gamma (0.65)
  });

  it('falls back to gamma when wsYesMidPrice deviates > 5%', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const ctx = { now: new Date(), wsYesMidPrice: 0.80 };  // > 5% deviation
    const result = await strategy.evaluate(market, ctx);
    
    expect(result).not.toBeNull();
    // La stratégie utilise gamma (0.65) au lieu de wsYesMidPrice
  });

  it('uses gamma when wsYesMidPrice is null', async () => {
    const market = makeMarket({
      outcomePrices: [
        { outcome: 'Yes', price: 0.65 },
        { outcome: 'No', price: 0.35 },
      ],
    });
    const ctx = { now: new Date(), wsYesMidPrice: null };
    const result = await strategy.evaluate(market, ctx);
    
    expect(result).not.toBeNull();
  });
});
```

### Critères d'acceptation
- [ ] `wsYesMidPrice` exposé via PriceFeed
- [ ] Contexte stratégie enrichi avec `wsYesMidPrice`
- [ ] Logique de fallback WebSocket → Gamma
- [ ] Validation de déviation < 5%
- [ ] Tests unitaires passent

---

## Phase 3: Spread Dynamique et TTL Adaptatif (P1)

### Objectif
Adapter le spread max et le TTL cache selon l'intervalle du marché.

### Fichiers à modifier
- `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts`
- `packages/crypto-algo/src/strategy/strategy-runner.ts`

### Tâches

#### 3.1 Spread dynamique selon interval

```typescript
// Fichier: naive-momentum.strategy.ts
// Modifier l'interface et le constructeur

export interface NaiveMomentumConfig {
  // ... champs existants ...
  
  /**
   * Maximum spread percentage allowed for signal generation.
   * Can be overridden per interval.
   * @default 5 (5%)
   */
  maxSpreadPercent: number;
  
  /**
   * NOUVEAU: Spread limits per interval.
   * Overrides maxSpreadPercent for matching intervals.
   */
  spreadByInterval?: Record<string, number>;
}

const DEFAULT_CONFIG: NaiveMomentumConfig = {
  baseThreshold: 0.55,
  maxSpreadPercent: 5,
  spreadAdjustmentFactor: 0.5,
  minSpreadForAdjustment: 1,
  spreadByInterval: {
    '5m': 10,   // Marchés 5min: spread jusqu'à 10%
    '10m': 8,
    '15m': 7,
    '30m': 6,
    '1h': 5,
    '4h': 5,
    '1d': 5,
  },
};

// Modifier evaluate
private getMaxSpreadForInterval(interval: string | null): number {
  if (!interval) return this.config.maxSpreadPercent;
  return this.config.spreadByInterval?.[interval] ?? this.config.maxSpreadPercent;
}

async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  // ... validation outcomes et prix ...

  const spreadPercent = ctx.topOfBook?.spreadPercent ?? null;
  const maxSpread = this.getMaxSpreadForInterval(market.interval);

  if (spreadPercent !== null && spreadPercent > maxSpread) {
    this.log.debug(
      { conditionId: market.conditionId, spreadPercent, maxSpread, interval: market.interval },
      'Spread exceeds limit for interval'
    );
    return null;
  }

  // ... suite ...
}
```

#### 3.2 TTL adaptatif selon interval

```typescript
// Fichier: strategy-runner.ts
// Modifier cache TTL

/**
 * TTL adaptatif selon l'intervalle du marché.
 * Marchés courts = TTL court, marchés longs = TTL long.
 */
private getCacheTtlForInterval(interval: string | null): number {
  if (!interval) return OUTCOME_PRICES_CACHE_TTL_MS;  // 30s par défaut
  
  const ttlMap: Record<string, number> = {
    '5m': 10_000,   // 10 secondes pour 5min
    '10m': 15_000,
    '15m': 20_000,
    '30m': 30_000,  // 30 secondes
    '1h': 60_000,   // 1 minute
    '4h': 120_000,  // 2 minutes
    '1d': 300_000,  // 5 minutes
  };
  
  return ttlMap[interval] ?? OUTCOME_PRICES_CACHE_TTL_MS;
}

// Modifier fetchGammaMarketCached
private async fetchGammaMarketCached(
  conditionId: string, 
  now: number,
  interval: string | null,  // NOUVEAU paramètre
): Promise<GammaMarket | null> {
  const cached = this.gammaCache.get(conditionId);
  const ttl = this.getCacheTtlForInterval(interval);
  
  if (cached && now - cached.fetchedAt < ttl) {
    return cached.market;
  }
  
  // ... fetch ...
}
```

### Critères d'acceptation
- [ ] Spread limit dynamique selon interval
- [ ] Cache TTL adaptatif selon interval
- [ ] Configuration via `spreadByInterval`
- [ ] Tests unitaires pour différents intervals

---

## Phase 4: Handler Résolution Immédiate (P2)

### Objectif
Désactiver immédiatement les marchés résolus au lieu d'attendre le janitor 60s.

### Fichiers à modifier
- `packages/crypto-algo/src/strategy/strategy-runner.ts`

### Tâches

#### 4.1 Améliorer handleMarketResolved

```typescript
// Fichier: strategy-runner.ts
// Modifier handleMarketResolved

private async handleMarketResolved(conditionId: string): Promise<void> {
  log.info({ conditionId }, 'market resolved event — immediate cleanup');

  // NOUVEAU: Désactiver immédiatement la sélection
  try {
    const selection = await this.algoSelectionService.getByConditionId(conditionId);
    if (selection && selection.enabled) {
      await this.algoSelectionService.setEnabled(conditionId, false);
      log.info({ conditionId }, 'selection disabled immediately on resolution');
    }
  } catch (err) {
    log.error({ err, conditionId }, 'failed to disable selection on resolution');
  }

  // NOUVEAU: Invalider le cache pour ce marché
  this.gammaCache.delete(conditionId);
  
  // NOUVEAU: Supprimer le top of book
  const assets = this.priceFeed.getAssetsForCondition(conditionId);
  if (assets) {
    if (assets.tokenIdYes) this.priceFeed.clearTopOfBook(assets.tokenIdYes);
    if (assets.tokenIdNo) this.priceFeed.clearTopOfBook(assets.tokenIdNo);
  }
}
```

#### 4.2 Ajouter méthodes à PriceFeed

```typescript
// Fichier: price-feed.ts
// Ajouter méthodes utilitaires

getAssetsForCondition(conditionId: string): { tokenIdYes: string | null; tokenIdNo: string | null } | undefined {
  return this.conditionToAssets.get(conditionId);
}

clearTopOfBook(assetId: string): void {
  this.topOfBook.delete(assetId);
}
```

### Critères d'acceptation
- [ ] Event `market_resolved` désactive immédiatement la sélection
- [ ] Cache invalidé pour le marché résolu
- [ ] Top of book nettoyé
- [ ] Logs pour traçabilité

---

## Phase 5: Validation Interval (P2)

### Objectif
Valider le format de l'intervalle et rejeter les marchés avec interval invalide.

### Fichiers à modifier
- `packages/crypto-algo/src/strategy/strategy-runner.ts`
- `packages/core/src/polymarket/market-list.ts`

### Tâches

#### 5.1 Constante des intervals valides

```typescript
// Fichier: packages/core/src/polymarket/market-list.ts
// Ajouter export

export const VALID_INTERVALS = ['5m', '10m', '15m', '30m', '1h', '4h', '1d', '1w', '1mo'] as const;
export type ValidInterval = typeof VALID_INTERVALS[number];

export function isValidInterval(interval: string | null): boolean {
  if (!interval) return true;  // null = non-crypto, accepté
  return VALID_INTERVALS.includes(interval as ValidInterval);
}
```

#### 5.2 Validation dans strategy-runner

```typescript
// Fichier: strategy-runner.ts
// Ajouter validation

import { isValidInterval } from '@polywatch/core';

// Dans evaluateSelection
if (!isValidInterval(selection.interval)) {
  log.warn(
    { conditionId: selection.conditionId, interval: selection.interval },
    'Invalid interval format, skipping selection'
  );
  continue;
}
```

#### 5.3 Tests

```typescript
// Ajouter tests pour isValidInterval
describe('Interval validation', () => {
  it('accepts valid intervals', () => {
    expect(isValidInterval('5m')).toBe(true);
    expect(isValidInterval('1h')).toBe(true);
    expect(isValidInterval('1d')).toBe(true);
  });

  it('rejects invalid intervals', () => {
    expect(isValidInterval('2m')).toBe(false);
    expect(isValidInterval('invalid')).toBe(false);
    expect(isValidInterval('')).toBe(false);
  });

  it('accepts null interval', () => {
    expect(isValidInterval(null)).toBe(true);
  });
});
```

### Critères d'acceptation
- [ ] Constante `VALID_INTERVALS` exportée
- [ ] Validation dans strategy-runner
- [ ] Logs warning pour interval invalide
- [ ] Tests unitaires

---

## Résumé du Plan

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 1: P0 - IMMÉDIAT                            │
│                    Validation Outcomes                               │
│                    0.5 jour | Impact: HAUT                           │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 2: P1 - PRIX TEMPS RÉEL                     │
│                    WebSocket midPrice                                │
│                    1 jour | Impact: MOYEN                            │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 3: P1 - CONFIG DYNAMIQUE                    │
│                    Spread + TTL adaptatifs                           │
│                    0.5 jour | Impact: MOYEN                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 4: P2 - RÉSOLUTION                          │
│                    Handler immédiat                                  │
│                    0.5 jour | Impact: BAS                            │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 5: P2 - VALIDATION                          │
│                    Interval + Tests                                  │
│                    0.5 jour | Impact: BAS                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Checklist de Déploiement

### Avant Merge
- [ ] Tous les tests unitaires passent (`npm test`)
- [ ] Lint passe (`npm run lint`)
- [ ] Build passe (`npm run build`)
- [ ] Review code par tech lead

### Après Merge
- [ ] Déployer en staging
- [ ] Vérifier logs de validation outcomes
- [ ] Vérifier utilisation WebSocket midPrice
- [ ] Monitoring des signaux générés

### Rollback
Si problèmes en production:
```bash
# Revert Phase 1 seulement (P0)
git revert <commit-phase-1>

# Ou revert complet
git revert <merge-commit>
```

---

**Plan préparé par:** PMA - Project Manager Agent  
**Date:** 2025-01-27  
**Prochaine étape:** Validation du plan par Tech Lead + Product Owner