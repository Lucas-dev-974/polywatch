# Plan d'Implémentation CORRIGÉ: Crypto-Algo Court Terme
## Corrections après Review du Code Existant

**Date:** 2025-01-27  
**Version:** 2.0 (Corrigée)  
**Effort estimé:** 2 jours (réduit de 3 jours)

---

## Corrections Apportées

| Bug | Sévérité | Correction |
|-----|----------|------------|
| `getYesMidPrice` existe déjà | HAUTE | Supprimé - utiliser méthode existante |
| `wsYesMidPrice` dans contexte | HAUTE | Utiliser `ctx.topToBook?.midPrice` |
| Signature `fetchGammaMarketCached` | MOYENNE | Ajouter paramètre `interval` aux appels |
| Méthodes inutiles price-feed | BASSE | Simplifié le handler |

---

## Phase 1: Validation Explicite Outcomes (P0)

**Effort:** 0.5 jour | **Impact:** HAUT

### Fichiers à modifier
- `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts`
- `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.test.ts`

### Tâches

#### 1.1 Ajouter logger à la classe

```typescript
import pino from 'pino';

export class NaiveMomentumStrategy implements CryptoAlgoStrategy {
  readonly id = 'naive-momentum';
  private readonly config: NaiveMomentumConfig;
  private readonly log = pino({ name: 'crypto-algo:naive-momentum' });
  // ...
}
```

#### 1.2 Validation explicite YES/NO

```typescript
async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  const prices = market.outcomePrices;
  if (!prices || prices.length < 2) return null;

  // Trouver YES et NO par label (au lieu de prices[0])
  const yesOutcome = prices.find(p => 
    ['yes', 'up'].includes(p.outcome.toLowerCase())
  );
  const noOutcome = prices.find(p => 
    ['no', 'down'].includes(p.outcome.toLowerCase())
  );

  if (!yesOutcome || !noOutcome) {
    this.log.warn(
      { conditionId: market.conditionId, outcomes: prices.map(p => p.outcome) },
      'Cannot identify YES/NO outcomes'
    );
    return null;
  }

  // Validation sum ≈ 1.0 (tolerance 2%)
  const sum = yesOutcome.price + noOutcome.price;
  if (Math.abs(sum - 1.0) > 0.02) {
    this.log.warn(
      { conditionId: market.conditionId, yesPrice: yesOutcome.price, noPrice: noOutcome.price, sum },
      'Invalid outcome prices: sum should be ~1.0'
    );
    return null;
  }

  const yesPrice = yesOutcome.price;
  // ... suite du code existant ...
}
```

#### 1.3 Tests unitaires

Ajouter tests pour:
- Reconnaissance "Up"/"Down"
- Rejet si sum ≠ 1.0
- Rejet si outcomes non reconnus

---

## Phase 2: Prix Temps Réel via WebSocket (P1) - VERSION CORRIGÉE

**Effort:** 0.5 jour | **Impact:** MOYEN

### Corrections
- ❌ NE PAS ajouter `getYesMidPrice` (existe déjà)
- ❌ NE PAS modifier `StrategyContext`
- ✅ Utiliser `ctx.topToBook?.midPrice` directement

### Code

```typescript
// Dans naive-momentum.strategy.ts evaluate()

const gammaYesPrice = yesOutcome.price;

// UTILISER midPrice EXISTANT (déjà dans TopOfBookData)
const wsMidPrice = ctx.topToBook?.midPrice;

let yesPrice: number;

if (wsMidPrice !== undefined && wsMidPrice !== null) {
  const deviation = Math.abs(wsMidPrice - gammaYesPrice);
  
  if (deviation < 0.05) {
    // Moins de 5% de déviation: utiliser WebSocket (temps réel)
    yesPrice = wsMidPrice;
  } else {
    // Déviation significative: utiliser Gamma
    yesPrice = gammaYesPrice;
    this.log.warn({ conditionId: market.conditionId, wsMidPrice, gammaYesPrice, deviation },
      'Significant price deviation, using Gamma price');
  }
} else {
  yesPrice = gammaYesPrice;
}
```

---

## Phase 3: Spread Dynamique et TTL Adaptatif (P1)

**Effort:** 0.5 jour | **Impact:** MOYEN

### 3.1 Spread dynamique

```typescript
// Dans NaiveMomentumConfig
spreadByInterval?: Record<string, number>;

// Dans DEFAULT_CONFIG
spreadByInterval: {
  '5m': 10,
  '10m': 8,
  '15m': 7,
  '30m': 6,
  '1h': 5,
  '4h': 5,
  '1d': 5,
}

// Nouvelle méthode
private getMaxSpreadForInterval(interval: string | null): number {
  if (!interval) return this.config.maxSpreadPercent;
  return this.config.spreadByInterval?.[interval] ?? this.config.maxSpreadPercent;
}
```

### 3.2 TTL adaptatif

```typescript
// Dans strategy-runner.ts
private getCacheTtlForInterval(interval: string | null): number {
  if (!interval) return OUTCOME_PRICES_CACHE_TTL_MS;
  
  const ttlMap: Record<string, number> = {
    '5m': 10_000,
    '10m': 15_000,
    '15m': 20_000,
    '30m': 30_000,
    '1h': 60_000,
    '4h': 120_000,
    '1d': 300_000,
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
  // ... reste inchangé ...
}

// Modifier les appels (ligne ~562)
gammaMarket = await this.fetchGammaMarketCached(
  selection.conditionId, 
  now.getTime(),
  selection.interval  // NOUVEAU
);
```

---

## Phase 4: Handler Résolution Immédiate (P2) - VERSION SIMPLIFIÉE

**Effort:** 0.25 jour | **Impact:** BAS

### Code (pas de nouvelles méthodes dans price-feed.ts)

```typescript
// Dans strategy-runner.ts handleMarketResolved
private async handleMarketResolved(conditionId: string): Promise<void> {
  log.info({ conditionId }, 'market resolved event — immediate cleanup');

  try {
    // Désactiver immédiatement
    await this.algoSelectionService.setEnabled(conditionId, false);
    log.info({ conditionId }, 'selection disabled immediately on resolution');
    
    // Invalider le cache
    this.gammaCache.delete(conditionId);
  } catch (err) {
    log.error({ err, conditionId }, 'failed to disable selection on resolution');
  }
}
```

---

## Phase 5: Validation Interval (P2)

**Effort:** 0.5 jour | **Impact:** BAS

### Code

```typescript
// Dans packages/core/src/polymarket/market-list.ts
export const VALID_INTERVALS = ['5m', '10m', '15m', '30m', '1h', '4h', '1d', '1w', '1mo'] as const;
export type ValidInterval = typeof VALID_INTERVALS[number];

export function isValidInterval(interval: string | null): boolean {
  if (!interval) return true;
  return VALID_INTERVALS.includes(interval as ValidInterval);
}

// Dans strategy-runner.ts evaluateSelection
if (!isValidInterval(selection.interval)) {
  log.warn({ conditionId: selection.conditionId, interval: selection.interval },
    'Invalid interval format, skipping selection');
  continue;
}
```

---

## Checklist

### Phase 1 ✅ COMPLÉTÉ
- [x] Ajouter logger `pino` à `NaiveMomentumStrategy`
- [x] Validation `prices.find()` pour YES/NO
- [x] Validation sum ≈ 1.0
- [x] Tests: "Up/Down", sum ≠ 1.0, outcomes invalides
- [x] **Tous les tests passent (18/18)**

### Phase 2 ✅ COMPLÉTÉ
- [x] Utiliser `ctx.topOfBook?.midPrice` comme source de prix temps réel
- [x] Fallback sur Gamma si WebSocket indisponible ou déviation > 5%
- [x] Ajouter `priceSource` aux raisons du signal
- [x] Tests: WebSocket disponible, déviation > 5%, WebSocket indisponible
- [x] **Tous les tests passent (22/22)**

### Phase 3 ✅ COMPLÉTÉ
- [x] Constantes `VALID_INTERVALS` et `SPREAD_BY_INTERVAL`
- [x] Mapping `INTERVAL_ALIASES` pour normaliser formats (5min -> 5m)
- [x] Méthode `getMaxSpreadForInterval()` pour spread dynamique
- [x] Validation interval avec normalisation
- [x] Tests: spread 5m vs 1h, aliases, intervalles valides
- [x] **Tous les tests passent (29/29)**

### Phase 4 ✅ COMPLÉTÉ
- [x] Handler `handleMarketResolved` pour désactiver immédiatement
- [x] Méthode `clearTopOfBook()` dans price-feed
- [x] Appel `setEnabled(false)` dans strategy-runner
- [x] Logs pour traçabilité

### Phase 5 ✅ COMPLÉTÉ (intégré avec Phase 3)
- [x] Validation interval dans `evaluate()`
- [x] Rejet des formats invalides
- [x] Tests: intervalles valides, format invalide

---

## Refactoring ✅ COMPLÉTÉ

- [x] Extraction des constantes dans `constants.ts`
- [x] Fonctions utilitaires réutilisables (`normalizeInterval`, `findOutcomes`, `validateOutcomePrices`)
- [x] Paramètres de configuration (`priceSumTolerance`, `maxPriceDeviation`)
- [x] Méthodes modulaires (`selectPrice`, `createSignal`)
- [x] **Tous les tests passent (29/29)**

---

**Effort total: ~2 jours** (réalisé en 1 session)