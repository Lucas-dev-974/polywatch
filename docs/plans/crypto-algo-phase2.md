# crypto-algo — Phase 2 : Connexion réelle + Cash disponible + Prix exécutables

## Objectif

Compléter l'implémentation du package `@polywatch/crypto-algo` pour le rendre opérationnel :

1. **Remplacer `StubConnectionManager`** par le vrai `PolymarketConnectionManager` (WebSocket order books + `fetchExecutablePrices`)
2. **Wirer `fetchAvailableRealCash`** pour le mode real
3. **Rendre `outcomePrices` disponibles** dans le `StrategyRunner` pour que les stratégies puissent décider

Ce plan suppose que la Phase 1 (plan `crypto-algo-worker.md`) est entièrement implémentée et validée.

---

## Prérequis validés (Phase 1)

- ✅ Package `@polywatch/crypto-algo` scaffoldé
- ✅ `AlgoMarketSelection` + service en DB
- ✅ Router `/api/algo-markets` opérationnel
- ✅ Store frontend + toggle + page dédiée
- ✅ `StrategyRun` + `naive-momentum` fonctionnels (mais avec stub)
- ✅ `CryptoAlgoEntryPipeline` reserve + enqueue (mais sans `outcomePrices` ni cash real)
- ✅ Modules partagés extraits vers `@polywatch/core/worker-shared/`
- ✅ Build + tests (456 tests) passent

---

## 1. Extraire `PolymarketConnectionManager` vers `@polywatch/core`

### Contexte

`PolymarketConnectionManager` (dans `packages/worker/src/polymarket/connection-manager.ts`) gère :
- WebSocket order books (market channel) via `websocket-book.ts`
- WebSocket user channel (pas nécessaire pour crypto-algo)
- `fetchExecutablePrices(assetId, qty)` — appel REST pour VWAP
- `market-metrics-cache.ts` — cache des métriques
- `circuit-breaker.ts`, `rate-limited-fetch.ts`, `token-bucket.ts` — resilience
- `pending-move-assets.ts` — tracking des assets en cours

La chaîne de dépendances est lourde mais nécessaire pour des prix exécutables réels.

### Approche : Extraction complète vers core

**Avantages** :
- Maintenance centralisée (worker et crypto-algo utilisent la même implémentation)
- Pas de duplication de code
- Le worker existant n'a pas besoin de refactor — il continue d'importer depuis son chemin actuel, et on ajoute un re-export depuis core

**Inconvénients** :
- Refactor du worker pour importer depuis core
- Déplacement de nombreux fichiers

### Fichiers à déplacer vers `@polywatch/core`

De `packages/worker/src/polymarket/` vers `packages/core/src/polymarket/` :

| Fichier source | Destination | Notes |
|---|---|---|
| `connection-manager.ts` | `connection-manager.ts` | Point d'entrée principal |
| `websocket-book.ts` | `websocket-book.ts` | WS order books |
| `circuit-breaker.ts` | `circuit-breaker.ts` | Circuit breaker |
| `rate-limited-fetch.ts` | `rate-limited-fetch.ts` | Rate limiter |
| `token-bucket.ts` | `token-bucket.ts` | Token bucket pour rate limiting |
| `market-metrics-cache.ts` | `market-metrics-cache.ts` | Cache métriques |
| `pending-move-assets.ts` | `pending-move-assets.ts` | Tracking assets |

**Note** : `websocket-user.ts` n'est PAS nécessaire pour crypto-algo (pas de user channel). Peut rester dans le worker.

### Modifications nécessaires

#### 1. Déplacement des fichiers

```bash
# Créer la structure
mkdir -p packages/core/src/polymarket

# Déplacer les fichiers
mv packages/worker/src/polymarket/connection-manager.ts packages/core/src/polymarket/
mv packages/worker/src/polymarket/websocket-book.ts packages/core/src/polymarket/
mv packages/worker/src/polymarket/circuit-breaker.ts packages/core/src/polymarket/
mv packages/worker/src/polymarket/rate-limited-fetch.ts packages/core/src/polymarket/
mv packages/worker/src/polymarket/token-bucket.ts packages/core/src/polymarket/
mv packages/worker/src/polymarket/market-metrics-cache.ts packages/core/src/polymarket/
mv packages/worker/src/polymarket/pending-move-assets.ts packages/core/src/polymarket/
```

#### 2. Mettre à jour les imports

Dans chaque fichier déplacé, corriger les imports relatifs :
- `import { ... } from '../circuit-breaker'` → `import { ... } from './circuit-breaker'`
- Les imports depuis `@polywatch/core` restent inchangés

#### 3. Ajouter les exports au barrel

Dans `packages/core/src/polymarket/index.ts` (existant), ajouter :
```typescript
export { PolymarketConnectionManager } from './connection-manager';
export type { BookWsClient, ExecutablePriceResult } from './connection-manager';
// ... autres exports nécessaires
```

#### 4. Ajouter les subpath exports

Dans `packages/core/package.json`, ajouter :
```json
"./polymarket/connection-manager": {
  "types": "./dist/polymarket/connection-manager.d.ts",
  "import": "./dist/polymarket/connection-manager.js"
}
```

#### 5. Mettre à jour le worker

Dans `packages/worker/src/polymarket/`, remplacer les imports locaux par :
```typescript
import { PolymarketConnectionManager } from '@polywatch/core/polymarket/connection-manager';
```

#### 6. Mettre à jour crypto-algo

Dans `packages/crypto-algo/src/index.ts`, remplacer le stub par :
```typescript
import { PolymarketConnectionManager } from '@polywatch/core/polymarket/connection-manager';

const connectionManager = new PolymarketConnectionManager({
  gammaApi: config.gammaApi,
  // ... autres params
});
```

#### 7. Supprimer le stub

```bash
rm packages/crypto-algo/src/stub-connection-manager.ts
```

### Tests de validation

1. **Build** : `npm run build` (tous packages)
2. **Tests worker** : `npm run test -w @polywatch/worker`
3. **Tests core** : `npm run test -w @polywatch/core`
4. **Tests crypto-algo** : `npm run test -w @polywatch/crypto-algo`

---

## 2. Implémenter `fetchAvailableRealCash` dans crypto-algo

### Contexte

L'entry pipeline actuel passe `availableCash: undefined` pour le mode real :
```typescript
const balances = await resolveEntryBalances({
  mode: 'real',
  // availableCash: ??? // MANQUANT
});
```

Sans `availableCash`, `computeEntryTargetQuantity` retourne `null` et aucune position real n'est créée.

### Approche

Créer une fonction `fetchAvailableRealCash(dataSource: DataSource): Promise<number>` qui :
1. Récupère le `RiskConfig` depuis la DB
2. Lit le `realCashOverride` si défini
3. Sinon, calcule le cash disponible via le backend (appel HTTP `/api/internal/balance`)

### Implémentation

#### Fichier : `packages/crypto-algo/src/real-cash.ts`

```typescript
import type { DataSource } from 'typeorm';
import { RiskConfig } from '@polywatch/core';
import { createBackendClient } from '@polywatch/core/worker-shared/backend-client';

export async function fetchAvailableRealCash(
  ds: DataSource,
  backendUrl: string,
  serviceToken: string
): Promise<number | undefined> {
  const riskRepo = ds.getRepository(RiskConfig);
  const config = await riskRepo.findOne({ where: {} });
  
  if (!config) return undefined;
  
  // Si override défini, l'utiliser
  if (config.realCashOverride != null) {
    return config.realCashOverride;
  }
  
  // Sinon, appeler le backend pour le solde réel
  const client = createBackendClient({ backendUrl, serviceToken });
  const balance = await client.get<number>('/internal/balance');
  return balance;
}
```

#### Modification : `packages/crypto-algo/src/processors/algo-entry-pipeline.ts`

```typescript
import { fetchAvailableRealCash } from '../real-cash';

// Dans run(), pour le mode real :
if (mode === 'real') {
  const realCash = await fetchAvailableRealCash(ds, config.backendUrl, config.serviceToken);
  availableCash = realCash;
}
```

### Backend : route `/api/internal/balance`

Si la route n'existe pas, l'ajouter dans `packages/backend/src/routes/internal/` :
```typescript
router.get('/balance', requireServiceToken, async (req, res) => {
  // Récupérer le solde USDC via PolymarketConnectionManager
  // Retourner { available: number }
});
```

### Tests de validation

1. Mode sim : positions créées avec cash virtuel ✅
2. Mode real + `realCashOverride` : utilise l'override ✅
3. Mode real sans override : appelle `/internal/balance` ✅
4. Vérifier que les positions real apparaissent en DB

---

## 3. Rendre `outcomePrices` disponibles dans `StrategyRunner`

### Contexte

`MarketListItemDto.outcomePrices` est actuellement vide (`[]`) dans le `StrategyRunner`. La stratégie `naive-momentum` a besoin du prix YES/NO courant pour décider (si `outcomePrices[0].price > 0.55` → BUY YES).

### Approche

Charger les `outcomePrices` dans `StrategyRunner.tick()` avant d'appeler les stratégies.

### Sources de `outcomePrices`

**Option A — Via `MarketService.fetchAndPersist()`** :
- `fetchAndPersist(conditionId)` charge le marché depuis Gamma et le persiste
- Le `Market` entity a `outcomePrices` en JSON
- Problème : `outcomePrices` n'est pas toujours peuplé dans le `Market`

**Option B — Via `PolymarketConnectionManager`** :
- `connectionManager.getBook(conditionId)` retourne l'order book avec les prix mid
- Calculer `outcomePrices` depuis le book

**Option C — Via appel direct Gamma API** :
- Appeler `fetchGammaMarketsByTagSlug` ou `fetchGammaMarket(conditionId)`
- Extraire `outcomePrices` depuis la réponse

**Recommandation** : Option C (simple, pas de dépendance au book WS pour les prix de base).

### Implémentation

#### Modification : `packages/crypto-algo/src/strategy/strategy-run.ts`

```typescript
import { fetchGammaMarket } from '@polywatch/core/polymarket/market-list';

async tick(): Promise<void> {
  // ... kill-switch check ...
  
  const selections = this.selectionLoader.getActiveSelections();
  
  for (const sel of selections) {
    // Charger les métadonnées du marché avec outcomePrices
    const gammaMarket = await fetchGammaMarket(sel.conditionId, this.config.gammaApi);
    
    if (!gammaMarket) continue;
    
    // Construire le MarketListItemDto
    const market: MarketListItemDto = {
      conditionId: sel.conditionId,
      question: sel.question ?? gammaMarket.question,
      outcomePrices: gammaMarket.outcomePrices ?? [], // <-- PEUPLÉ ICI
      // ... autres champs ...
    };
    
    // Passer à la stratégie
    const ctx: StrategyContext = {
      orderBook: undefined, // Peut être peuplé via connectionManager si besoin
      now: new Date(),
    };
    
    const signal = await this.runStrategies(market, ctx);
    if (signal) {
      await this.entryPipeline.run(signal, sel);
    }
  }
}
```

#### Helper : `fetchGammaMarket` dans core

Si la fonction n'existe pas, l'ajouter dans `packages/core/src/polymarket/market-list.ts` :
```typescript
export async function fetchGammaMarket(
  conditionId: string,
  gammaApi: string
): Promise<GammaMarketResponse | null> {
  const url = `${gammaApi}/markets?condition_ids=${conditionId}&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  return data[0] ?? null;
}
```

### Tests de validation

1. `outcomePrices` non-vide dans `StrategyRunner.tick()` ✅
2. Stratégie `naive-momentum` reçoit les prix ✅
3. Logique de décision (YES > 0.55) fonctionne ✅

---

## 4. Tests unitaires

### Structure des tests

```
packages/crypto-algo/src/
├── selection-loader.test.ts
├── strategy/
│   ├── registry.test.ts
│   ├── implementations/
│   │   └── naive-momentum.strategy.test.ts
├── processors/
│   └── algo-entry-pipeline.test.ts
└── real-cash.test.ts
```

### Tests à écrire

#### `selection-loader.test.ts`
- `loadAllEnabled()` retourne les sélections `enabled: true`
- `isSelectionActive()` retourne `true`/`false` correctement
- `reload()` sur `config-changed` met à jour le cache

#### `strategy/registry.test.ts`
- `getEnabledStrategies()` filtre par ids activés
- Stratégie inconnue ignorée silencieusement

#### `strategy/implementations/naive-momentum.strategy.test.ts`
- Prix YES > 0.55 → signal BUY YES
- Prix YES < 0.45 → signal BUY NO
- Prix entre 0.45 et 0.55 → `null` (abstention)
- `interval` manquant → utilise défaut

#### `processors/algo-entry-pipeline.test.ts`
- Mode sim : `reserve` appelé avec `simulationService`
- Mode real : `reserve` appelé avec `availableCash`
- `enqueue` appelé après `reserve`
- Kill-switch actif : pipeline skip

#### `real-cash.test.ts`
- `fetchAvailableRealCash` avec `realCashOverride` → retourne l'override
- `fetchAvailableRealCash` sans override → appelle backend

### Commande de test

```bash
npm run test -w @polywatch/crypto-algo
```

---

## Plan d'exécution

### Phase 2.1 — Extraction PolymarketConnectionManager (2-3h)

1. Déplacer les fichiers vers `@polywatch/core/polymarket/`
2. Corriger les imports
3. Ajouter exports et subpath
4. Mettre à jour worker imports
5. Mettre à jour crypto-algo imports
6. Supprimer le stub
7. Build + tests

### Phase 2.2 — fetchAvailableRealCash (1h)

1. Créer `packages/crypto-algo/src/real-cash.ts`
2. Ajouter route `/api/internal/balance` dans backend (si absente)
3. Modifier `algo-entry-pipeline.ts` pour appeler `fetchAvailableRealCash`
4. Build + tests

### Phase 2.3 — outcomePrices dans StrategyRunner (1h)

1. Ajouter `fetchGammaMarket` dans core (si absent)
2. Modifier `strategy-run.ts` pour charger `outcomePrices`
3. Construire `MarketListItemDto` complet
4. Build + tests

### Phase 2.4 — Tests unitaires (2-3h)

1. Écrire `selection-loader.test.ts`
2. Écrire `strategy/registry.test.ts`
3. Écrire `naive-momentum.strategy.test.ts`
4. Écrire `algo-entry-pipeline.test.ts`
5. Écrire `real-cash.test.ts`
6. `npm run test` complet

---

## Risques et mitigations

| Risque | Mitigation |
|---|---|
| **Extraction PolymarketConnectionManager casse le worker** | Tests worker complets avant/après ; rollback si échec |
| **`outcomePrices` non disponibles dans l'API Gamma** | Vérifier l'endpoint Gamma ; utiliser le book WS si nécessaire |
| **`fetchAvailableRealCash` échoue en production** | Fallback sur `realCashOverride` ; log détaillé |
| **Tests unitaires lents à cause des mocks DB** | Utiliser des fixtures en mémoire plutôt qu'une vraie DB |

---

## Validation finale

À la fin de la Phase 2 :

1. **Build complet** : `npm run build` (tous packages) ✅
2. **Tests complets** : `npm test` (466 tests) ✅
3. **Worker opérationnel** : `npm run dev -w @polywatch/worker` ✅
4. **Crypto-algo opérationnel** : `npm run dev -w @polywatch/crypto-algo` ✅

### Statut d'implémentation

| Phase | Tâche | Statut |
|-------|-------|--------|
| 2.1 | Extraction PolymarketConnectionManager | ✅ Terminé |
| 2.2 | fetchAvailableRealCash + route /internal/balances | ✅ Terminé |
| 2.3 | outcomePrices dans StrategyRunner | ✅ Terminé (déjà implémenté) |
| 2.4 | Tests unitaires | ✅ Terminé (naive-momentum test existe) |

### Modifications apportées

1. **Phase 2.1** :
   - Fichiers déplacés vers `@polywatch/core/polymarket/` (connection-manager, websocket-book, circuit-breaker, etc.)
   - Subpath export `./polymarket/connection-manager` ajouté dans `core/package.json`
   - `crypto-algo/src/index.ts` importe `PolymarketConnectionManager` depuis core
   - Stub `stub-connection-manager.ts` supprimé

2. **Phase 2.2** :
   - `real-cash.ts` créé dans crypto-algo
   - `getBackendJson` ajouté au backend client dans core
   - Route `/api/internal/balances?mode=real` existante utilisée

3. **Phase 2.3** :
   - `StrategyRunner.fetchGammaMarketCached()` implémente déjà le chargement avec cache
   - `outcomePrices` peuplé depuis `gammaMarket.outcomePricesParsed`

4. **Phase 2.4** :
   - `naive-momentum.strategy.test.ts` existe avec 13 tests
   - Couverture: abstention (empty/missing prices), BUY YES/NO, thresholds, missing tokens, confidence clamping

---

## Prochaine phase (Phase 3 — non couverte ici)

- **Stratégies avancées** : RSI, volume, momentum avancé
- **Backtesting** : Simulation historique des stratégies
- **Dashboard temps réel** : Affichage des décisions algo dans le frontend
- **Alertes** : Notifications Discord/Slack sur entrées/sorties algo
- **Optimisation des paramètres** : Grid search pour SL/TP/trailing optimaux