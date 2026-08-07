# Review du Plan d'Implémentation - Analyse des Bugs Potentiels

**Date:** 2025-01-27  
**Fichier analysé:** `IMPLEMENTATION_PLAN_CRYPTO_ALGO.md`

---

## 🔴 BUGS CRITIQUES IDENTIFIÉS

### Bug 1: Phase 2 - Méthode `getYesMidPrice` existe DÉJÀ

**Localisation:** Plan Phase 2.1, fichier `price-feed.ts`

**Problème:**
Le plan propose d'ajouter une méthode `getYesMidPrice` dans `price-feed.ts`, mais cette méthode **existe déjà**:

```typescript
// price-feed.ts lignes 253-259 (CODE EXISTANT)
getYesMidPrice(conditionId: string): number | null {
  const mapping = this.conditionToAssets.get(conditionId);
  if (!mapping?.tokenIdYes) return null;

  const tob = this.topOfBook.get(mapping.tokenIdYes);
  return tob?.midPrice ?? null;
}
```

**Impact:** Si on ajoute cette méthode, on aura un doublon → erreur de compilation.

**Correction:**
- ❌ Ne PAS ajouter cette méthode
- ✅ Utiliser la méthode existante

---

### Bug 2: Phase 2 - `StrategyContext` utilise déjà le bon type

**Localisation:** Plan Phase 2.2, fichier `strategy-runner.ts`

**Problème:**
Le plan propose d'ajouter `wsYesMidPrice` au `StrategyContext`, mais:

1. `getYesMidPrice()` retourne déjà `number | null`
2. Le type `TopOfBookData` existe déjà dans `strategy.ts`
3. `getTopOfBookForCondition()` existe déjà et retourne `TopOfBookData`

```typescript
// strategy.ts lignes 6-17 (CODE EXISTANT)
export interface TopOfBookData {
  bid: number;
  ask: number;
  spread: number;
  midPrice: number;
  spreadPercent: number;
}
```

```typescript
// price-feed.ts lignes 280-294 (CODE EXISTANT)
getTopOfBookForCondition(conditionId: string): TopOfBookData | null {
  const mapping = this.conditionToAssets.get(conditionId);
  if (!mapping?.tokenIdYes) return null;

  const tob = this.topOfBook.get(mapping.tokenIdYes);
  if (!tob) return null;

  return {
    bid: tob.bid,
    ask: tob.ask,
    spread: tob.spread,
    midPrice: tob.midPrice,
    spreadPercent: tob.spreadPercent,
  };
}
```

**Impact:** Le `TopOfBookData` contient déjà `midPrice`. Pas besoin d'ajouter un champ séparé.

**Correction:**
- ❌ Ne PAS ajouter `wsYesMidPrice` au contexte
- ✅ `topOfBook.midPrice` est déjà disponible dans la stratégie

---

### Bug 3: Phase 2 - `ctx.topOfBook` déjà passé à la stratégie

**Localisation:** Plan Phase 2.2, fichier `strategy-runner.ts`

**Problème:**
Le plan propose de passer `wsYesMidPrice` au contexte, mais le code existant passe déjà `topOfBook`:

```typescript
// strategy-runner.ts lignes 567-568 (CODE EXISTANT)
const topOfBook = topOfBookMap.get(selection.conditionId);
const ctx: StrategyContext = { now, topOfBook };
```

Le `topOfBook` contient déjà `midPrice` (via `getTopOfBookForCondition`).

**Correction:**
- ✅ Utiliser `ctx.topOfBook?.midPrice` directement dans la stratégie
- ❌ Ne PAS ajouter `wsYesMidPrice` au contexte

---

## 🟡 PROBLÈMES DE CONCEPTION

### Problème 1: Phase 4 - Méthodes `getAssetsForCondition` et `clearTopOfBook`

**Localisation:** Plan Phase 4.2, fichier `price-feed.ts`

**Problème:**
Le plan propose d'ajouter:
```typescript
getAssetsForCondition(conditionId: string): { tokenIdYes: string | null; tokenIdNo: string | null } | undefined {
  return this.conditionToAssets.get(conditionId);
}

clearTopOfBook(assetId: string): void {
  this.topOfBook.delete(assetId);
}
```

**Analyse:**
1. `getAssetsForCondition` - ✅ Acceptable (expose `conditionToAssets` en lecture seule)
2. `clearTopOfBook` - ⚠️ Pas nécessaire car:
   - `handleMarketResolved` peut juste appeler `topOfBook.delete()` directement
   - Ou utiliser `unsubscribeStale()` qui nettoie déjà `topOfBook`

**Correction proposée:**
```typescript
// Dans strategy-runner.ts handleMarketResolved
private async handleMarketResolved(conditionId: string): Promise<void> {
  log.info({ conditionId }, 'market resolved event — immediate cleanup');

  // Désactiver la sélection immédiatement
  try {
    await this.algoSelectionService.setEnabled(conditionId, false);
    log.info({ conditionId }, 'selection disabled immediately on resolution');
  } catch (err) {
    log.error({ err, conditionId }, 'failed to disable selection on resolution');
  }

  // Invalider le cache pour ce marché
  this.gammaCache.delete(conditionId);
  
  // Pas besoin de clearTopOfBook car priceFeed.unsubscribeStale le fera
  // ou on peut appeler priceFeed.unsubscribeStale([conditionId])
}
```

---

### Problème 2: Phase 3 - Signature `fetchGammaMarketCached`

**Localisation:** Plan Phase 3.2, fichier `strategy-runner.ts`

**Problème:**
Le plan propose:
```typescript
private async fetchGammaMarketCached(
  conditionId: string, 
  now: number,
  interval: string | null,  // NOUVEAU paramètre
): Promise<GammaMarket | null>
```

Mais la signature actuelle est:
```typescript
private async fetchGammaMarketCached(
  conditionId: string,
  now: number,
): Promise<GammaMarket | null>
```

**Impact:** Il faut modifier tous les appels à cette méthode pour passer `interval`.

**Code actuel (ligne 562):**
```typescript
gammaMarket = await this.fetchGammaMarketCached(selection.conditionId, now.getTime());
```

**Correction:** Ajouter `selection.interval` comme paramètre:
```typescript
gammaMarket = await this.fetchGammaMarketCached(
  selection.conditionId, 
  now.getTime(),
  selection.interval  // NOUVEAU
);
```

---

## ✅ PHASE 1 - CORRECTE (avec ajustement)

### Validation Outcomes - Code Corrigé

Le plan propose d'utiliser `prices.find()` mais le code existant utilise:

```typescript
// naive-momentum.strategy.ts ligne 80-84 (CODE EXISTANT)
const prices = market.outcomePrices;
if (!prices || prices.length === 0) return null;

const yesPrice = prices[0]?.price;  // ← Convention non validée
```

**Code corrigé proposé:**
```typescript
const prices = market.outcomePrices;
if (!prices || prices.length < 2) return null;

// Trouver YES et NO par label
const yesOutcome = prices.find(p => 
  ['yes', 'up'].includes(p.outcome.toLowerCase())
);
const noOutcome = prices.find(p => 
  ['no', 'down'].includes(p.outcome.toLowerCase())
);

// Validation
if (!yesOutcome || !noOutcome) {
  log.warn(
    { conditionId: market.conditionId, outcomes: prices.map(p => p.outcome) },
    'Cannot identify YES/NO outcomes'
  );
  return null;
}

// Validation sum ≈ 1.0 (tolerance 2%)
const sum = yesOutcome.price + noOutcome.price;
if (Math.abs(sum - 1.0) > 0.02) {
  log.warn(
    { conditionId: market.conditionId, yesPrice: yesOutcome.price, noPrice: noOutcome.price, sum },
    'Invalid outcome prices: sum should be ~1.0'
  );
  return null;
}

const yesPrice = yesOutcome.price;
```

**✅ Ce code est correct et n'introduit pas de bug.**

---

## ✅ PHASE 2 - VERSION CORRIGÉE

### Au lieu d'ajouter `wsYesMidPrice`, utiliser `topOfBook.midPrice`

**Code corrigé:**
```typescript
// naive-momentum.strategy.ts
async evaluate(market: MarketListItemDto, ctx: StrategyContext): Promise<AlgoSignal | null> {
  // ... validation outcomes ...

  const gammaYesPrice = yesOutcome.price;
  
  // ✅ UTILISER topOfBook.midPrice DÉJÀ DISPONIBLE
  const wsMidPrice = ctx.topOfBook?.midPrice;

  let yesPrice: number;
  
  if (wsMidPrice !== undefined && wsMidPrice !== null) {
    const deviation = Math.abs(wsMidPrice - gammaYesPrice);
    
    if (deviation < 0.05) {
      yesPrice = wsMidPrice;
      log.debug({ conditionId: market.conditionId, wsMidPrice, gammaYesPrice },
        'Using WebSocket midPrice for YES');
    } else {
      yesPrice = gammaYesPrice;
      log.warn({ conditionId: market.conditionId, wsMidPrice, gammaYesPrice, deviation },
        'Significant price deviation, using Gamma price');
    }
  } else {
    yesPrice = gammaYesPrice;
  }

  // ... suite du code ...
}
```

**✅ Cette approche utilise le code existant sans modification de l'interface.**

---

## ✅ PHASE 3 - VERSION CORRIGÉE

### Spread dynamique - Code correct

Le code proposé pour le spread dynamique est correct:

```typescript
private getMaxSpreadForInterval(interval: string | null): number {
  if (!interval) return this.config.maxSpreadPercent;
  return this.config.spreadByInterval?.[interval] ?? this.config.maxSpreadPercent;
}
```

**⚠️ Attention:** Ajouter validation que `interval` correspond à un format connu.

---

## ✅ PHASE 4 - VERSION CORRIGÉE

### Handler résolution - Code simplifié

```typescript
// strategy-runner.ts
private async handleMarketResolved(conditionId: string): Promise<void> {
  log.info({ conditionId }, 'market resolved event — immediate cleanup');

  // Désactiver la sélection immédiatement
  try {
    await this.algoSelectionService.setEnabled(conditionId, false);
    log.info({ conditionId }, 'selection disabled immediately on resolution');
    
    // Invalider le cache
    this.gammaCache.delete(conditionId);
  } catch (err) {
    log.error({ err, conditionId }, 'failed to disable selection on resolution');
  }
}
```

**✅ Pas besoin de nouvelles méthodes dans price-feed.ts.**

---

## ✅ PHASE 5 - CORRECTE

La validation d'interval est correcte et n'introduit pas de bug.

---

## RÉSUMÉ DES CORRECTIONS

| Phase | Bug | Sévérité | Correction |
|-------|-----|----------|------------|
| **Phase 1** | ✅ Aucun | - | Code correct |
| **Phase 2** | 🔴 `getYesMidPrice` existe déjà | HAUTE | Supprimer l'ajout de la méthode |
| **Phase 2** | 🔴 `wsYesMidPrice` dans contexte | HAUTE | Utiliser `ctx.topOfBook?.midPrice` |
| **Phase 3** | 🟡 Signature modifiée | MOYENNE | Passer `selection.interval` |
| **Phase 4** | 🟡 Méthodes inutiles | BASSE | Simplifier le handler |
| **Phase 5** | ✅ Aucun | - | Code correct |

---

## PLAN CORRIGÉ - IMPLÉMENTATION RECOMMANDÉE

### Phase 1: Validation Outcomes (0.5 jour)
- ✅ Code du plan correct avec ajustement pour utiliser `prices.find()`

### Phase 2: Prix temps réel (0.5 jour - RÉDUIT)
- ❌ Ne PAS ajouter `getYesMidPrice` (existe déjà)
- ❌ Ne PAS modifier `StrategyContext`
- ✅ Utiliser directement `ctx.topOfBook?.midPrice` dans la stratégie
- ✅ Ajouter logique de déviation dans `naive-momentum.strategy.ts`

### Phase 3: Spread dynamique + TTL (0.5 jour)
- ✅ Ajouter méthode `getMaxSpreadForInterval()`
- ⚠️ Modifier signature `fetchGammaMarketCached(conditionId, now, interval)`
- ⚠️ Passer `selection.interval` à tous les appels

### Phase 4: Handler résolution (0.25 jour - RÉDUIT)
- ✅ Modifier `handleMarketResolved` dans `strategy-runner.ts`
- ❌ Ne PAS ajouter méthodes dans `price-feed.ts`

### Phase 5: Validation interval (0.5 jour)
- ✅ Code correct

**Total corrigé: ~2 jours** (vs 3 jours dans le plan original)

---

**Review effectué par:** PMA - Project Manager Agent  
**Date:** 2025-01-27  
**Statut:** Plan nécessite des corrections avant implémentation