# 🔍 AUDIT : Système de Surveillance Up/Down (Crypto Algo)

**Date :** 25 juin 2026  
**Auteur :** ProjectManager-Agent  
**Version :** 1.0  
**Contexte :** Analyse complète du système de découverte et surveillance des marchés Up/Down court terme

---

## 1. RÉSUMÉ EXÉCUTIF

Le système de surveillance Up/Down permet de suivre automatiquement les marchés Polymarket de type "Bitcoin Up or Down - 5 min window". Il repose sur un pipeline de découverte qui interroge l'API Gamma de Polymarket, filtre les résultats, et sélectionne le marché actif le plus pertinent.

**Verdict :** ✅ Fonctionnel mais **fragile** — 4 faiblesses de conception identifiées, dont 2 critiques.

---

## 2. ARCHITECTURE GLOBALE

```
┌─────────────────────────────────────────────────────────────────────┐
│                     FRONTEND (SolidJS)                              │
│  CryptoAlgoPage.tsx                                                 │
│  ├─ loadMarketPrices() → GET /api/algo/markets-prices              │
│  ├─ socket.on('algo_markets_changed') → loadMarketPrices()         │
│  └─ socket.on('market_pct_update') → update prices in real-time    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND (Express)                                │
│  /api/algo/auto-track                                               │
│  ├─ POST   → createRule() + discoverAndAddMarket()                 │
│  ├─ PATCH  → setEnabled(true) + discoverAndAddMarket()             │
│  └─ GET    → loadAll()                                              │
│                                                                     │
│  /api/algo/markets                                                  │
│  ├─ POST   → addSelection() + emitAlgoMarketsChanged()              │
│  ├─ DELETE → removeSelection() + emitAlgoMarketsChanged()           │
│  └─ PATCH  → setEnabled() + emitAlgoMarketsChanged()               │
│                                                                     │
│  POST /api/algo/markets/notify-changed                              │
│  └─ Called by crypto-algo worker                                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  CRYPTO-ALGO WORKER                                  │
│  index.ts                                                           │
│  ├─ Janitor (60s): runAutoTrackCycle()                               │
│  │   ├─ disableResolved()                                            │
│  │   └─ discoverCurrentMarket() for each rule                       │
│  ├─ AlgoMarketPercentPublisher                                       │
│  │   └─ connectionManager.onBookUpdate() → POST /internal/...       │
│  └─ StrategyRunner                                                   │
│      └─ WebSocket subscriptions for active markets                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EXTERNAL APIs                                    │
│  Polymarket Gamma API                                                │
│  └─ GET /events?tag_slug=5M&active=true&limit=50                    │
│  └─ Returns: conditionId, question, cryptoSymbol, cryptoCategory     │
│                                                                      │
│  Polymarket WebSocket                                                │
│  └─ Real-time order book updates → AlgoMarketPercentPublisher      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. PIPELINE DE DÉCOUVERTE (5 ÉTAPES)

### Étape 1 : Règle Auto-Track

**Déclencheurs :**
- Création d'une règle (`POST /api/algo/auto-track`)
- Activation d'une règle (`PATCH /api/algo/auto-track/:id` avec `enabled: true`)
- Janitor worker (toutes les 60s)

**Entrée :** `{ cryptoSymbol: "Bitcoin", interval: "5m" }`

**Fichier :** `packages/backend/src/routes/algo-auto-track.ts`

---

### Étape 2 : Traduction Interval → Tag Slug

```typescript
// packages/core/src/polymarket/market-list.ts
export const INTERVAL_TAG_SLUG: Record<string, string> = {
  '5m': '5M',
  '15m': '15M',
  '1h': '1H',
  '4h': '4H',
  '1d': 'daily',
  '1w': 'weekly',
  '1mo': 'monthly',
  '1y': 'yearly',
};
```

**⚠️ Problème :** Mapping statique. Si Polymarket ajoute `10m` ou `30m`, le système ne les supporte pas.

---

### Étape 3 : Appel API Gamma

```typescript
// packages/core/src/services/algo-auto-track.service.ts
const result = await fetchGammaMarketsByTagSlug({
  tagSlug: '5M',
  limit: 50,
  active: true,
  order: 'volume24hr',
});
```

**URL générée :**
```
GET https://gamma-api.polymarket.com/events?tag_slug=5M&active=true&limit=50&order=volume24hr
```

**Réponse :** Liste de marchés avec `conditionId`, `question`, `cryptoSymbol`, `cryptoCategory`, `startDate`, `endDate`, `volume24hr`.

---

### Étape 4 : Filtrage des Résultats

```typescript
// packages/core/src/services/algo-auto-track.service.ts
const candidates = result.items.filter((item) =>
  item.cryptoSymbol === cryptoSymbol &&      // ✅ Le bon crypto
  item.cryptoCategory === 'up-down' &&       // ✅ Type Up/Down
  isMarketActive(item, now)                 // ✅ Pas expiré/résolu
);
```

#### Fonction `isMarketActive`

```typescript
// packages/core/src/polymarket/market-list.ts
export function isMarketActive(item: MarketListItemDto, now: number): boolean {
  if (item.closed) return false;
  if (item.resolved) return false;
  if (item.endDate) {
    const end = new Date(item.endDate).getTime();
    if (end < now) return false;
  }
  return true;
}
```

#### Classification `cryptoCategory`

```typescript
function classifyCryptoCategory(question: string | null): string | null {
  if (!question) return null;
  if (/\bup or down\b/i.test(question)) return 'up-down';
  if (/\b(above|below)\b/i.test(question)) return 'above-below';
  if (/\bwhat price will\b/i.test(question)) return 'target-price';
  if (/(price|hit).*(\d+\s*[-–—]\s*\d+|range)|range/i.test(question)) {
    return 'price-range';
  }
  return 'other';
}
```

**⚠️ Problème :** Dépendance au format exact `"Up or Down"` dans la question.

---

### Étape 5 : Sélection du Meilleur Marché

```typescript
// packages/core/src/services/algo-auto-track.service.ts
candidates.sort((a, b) => {
  const aStart = a.startDate ? new Date(a.startDate).getTime() : Infinity;
  const bStart = b.startDate ? new Date(b.startDate).getTime() : Infinity;
  return aStart - bStart;
});

return candidates[0]!.conditionId;
```

**⚠️ Problème :** Tri non-déterministe si plusieurs marchés ont le même `startDate`.

---

## 4. PROBLÈMES IDENTIFIÉS

### 🔴 Critique #1 : Fail-Open sur Erreur API Gamma

**Fichier :** `packages/core/src/services/algo-auto-track.service.ts` (ligne 218-221)

```typescript
} catch {
  // If Gamma API fails, assume the market is still active
  return true;
}
```

**Problème :** Si l'API Gamma est en panne, `hasActiveSelectionForRule` retourne `true`, ce qui empêche la découverte de nouveaux marchés.

**Impact :** L'auto-track devient aveugle jusqu'à la reprise de l'API.

**Solution recommandée :**
```typescript
} catch (err) {
  log.warn({ err, cryptoSymbol, interval }, 'Gamma API failed');
  return false; // Permettre la découverte au prochain cycle
}
```

---

### 🔴 Critique #2 : Race Condition Janitor

**Fichier :** `packages/crypto-algo/src/index.ts`

```typescript
// Janitor 1 (StrategyRunner) : disableResolved() toutes les 60s
strategyRunner.startJanitor();

// Janitor 2 (auto-track) : runAutoTrackCycle() toutes les 60s
const autoTrackTimer = safeInterval(async () => {
  const added = await runAutoTrackCycle(autoTrackService, algoSelectionService);
  // ...
}, 60_000);
```

**Problème :** Les deux janitors s'exécutent indépendamment. Si `disableResolved` désactive un marché pendant que `runAutoTrackCycle` le découvre, l'état peut être incohérent.

**Solution recommandée :** Fusionner les deux cycles :
```typescript
const autoTrackTimer = safeInterval(async () => {
  // 1. D'abord désactiver les marchés résolus
  await algoSelectionService.disableResolved();
  
  // 2. Ensuite découvrir les nouveaux marchés
  const added = await runAutoTrackCycle(autoTrackService, algoSelectionService);
  
  if (added > 0) {
    await selectionLoader.reload();
    await postBackendJson('/api/algo/markets/notify-changed', {});
  }
}, 60_000, 'crypto-algo:auto-track-janitor');
```

---

### 🟡 Moyen #3 : Tri Non-Déterministe

**Fichier :** `packages/core/src/services/algo-auto-track.service.ts` (ligne 150-158)

```typescript
candidates.sort((a, b) => {
  const aStart = a.startDate ? new Date(a.startDate).getTime() : Infinity;
  const bStart = b.startDate ? new Date(b.startDate).getTime() : Infinity;
  return aStart - bStart;
});
```

**Problème :** Si deux marchés Bitcoin 5m commencent à la même heure, le choix est arbitraire.

**Solution recommandée :**
```typescript
candidates.sort((a, b) => {
  const aStart = a.startDate ? new Date(a.startDate).getTime() : Infinity;
  const bStart = b.startDate ? new Date(b.startDate).getTime() : Infinity;
  if (aStart !== bStart) return aStart - bStart;
  // Tie-breaker: préférer le plus liquide
  return (b.volume24hr ?? 0) - (a.volume24hr ?? 0);
});
```

---

### 🟡 Moyen #4 : Dépendance au Format de Question

**Fichier :** `packages/core/src/polymarket/market-list.ts` (ligne 304)

```typescript
if (/\bup or down\b/i.test(question)) return 'up-down';
```

**Problème :** Si Polymarket change le format (ex: "Up/Down", "Hausse/Baisse"), la classification échoue.

**Impact :** `cryptoCategory !== 'up-down'` → aucun marché trouvé.

**Solution recommandée :** Ajouter des patterns alternatifs :
```typescript
function classifyCryptoCategory(question: string | null): string | null {
  if (!question) return null;
  if (/\b(up or down|up\/down|up-down)\b/i.test(question)) return 'up-down';
  // ...
}
```

---

### 🟢 Faible #5 : Duplication de Logique API

**Fichier :** `packages/core/src/services/algo-auto-track.service.ts`

`hasActiveSelectionForRule` et `discoverCurrentMarket` font tous deux un appel à l'API Gamma avec les mêmes paramètres.

**Solution recommandée :** Fusionner les deux fonctions ou utiliser un cache partagé.

---

### 🟢 Faible #6 : Mapping Interval Statique

**Fichier :** `packages/core/src/polymarket/market-list.ts` (ligne 366-375)

```typescript
export const INTERVAL_TAG_SLUG: Record<string, string> = {
  '5m': '5M',
  '15m': '15M',
  '1h': '1H',
  '4h': '4H',
  '1d': 'daily',
  '1w': 'weekly',
  '1mo': 'monthly',
  '1y': 'yearly',
};
```

**Problème :** Si Polymarket ajoute `10m`, `30m`, le système ne les supporte pas.

**Solution recommandée :** Valider côté frontend que seuls les intervalles supportés sont proposés.

---

## 5. FICHIERS MODIFIÉS (Session en cours)

| Fichier | Modification | Statut |
|---------|-------------|--------|
| `packages/core/src/services/algo-market-selection.service.ts` | `disableResolved()` utilise API Gamma au lieu de table Market | ✅ |
| `packages/core/src/services/algo-auto-track.service.ts` | Logs de diagnostic ajoutés | ✅ |
| `packages/backend/src/websocket.ts` | Fonction `emitAlgoMarketsChanged()` ajoutée | ✅ |
| `packages/backend/src/routes/algo-markets.ts` | WebSocket event après add/remove/patch + endpoint notify-changed | ✅ |
| `packages/backend/src/routes/algo-auto-track.ts` | Découverte immédiate via `discoverAndAddMarket()` | ✅ |
| `packages/frontend/src/components/CryptoAlgoPage.tsx` | Écoute `algo_markets_changed` + filtrage actif/inactif | ✅ |
| `packages/crypto-algo/src/index.ts` | Backend client + notification après auto-track | ✅ |
| `packages/crypto-algo/src/auto-track-janitor.ts` | Logs de diagnostic ajoutés | ✅ |

---

## 6. TESTS DE COHÉRENCE

| Test | Résultat | Détail |
|------|----------|--------|
| Build all packages | ✅ OK | core, backend, crypto-algo, frontend |
| Tests unitaires (475) | ✅ OK | Tous passent |
| `activeMarketPrices()` filtre correctement | ✅ OK | `enabled && !resolved && !closed` |
| `disableResolved()` utilise API Gamma | ✅ OK | Plus de dépendance à la table Market |
| `discoverAndAddMarket()` immédiat | ✅ OK | Appelé sur POST et PATCH auto-track |
| WebSocket `algo_markets_changed` | ✅ OK | Émis sur toutes les mutations |
| `AlgoMarketPercentPublisher` temps réel | ✅ OK | Prix Up/Down live via WebSocket |
| Race condition janitor | ❌ NON | `disableResolved` et `runAutoTrackCycle` non synchronisés |
| Fail-open API Gamma | ❌ NON | `hasActiveSelectionForRule` retourne `true` en cas d'erreur |
| Tri non-déterministe | ❌ NON | Pas de tie-breaker sur volume |

---

## 7. RECOMMANDATIONS PRIORITAIRES

| Priorité | Problème | Action | Effort |
|----------|----------|--------|--------|
| **P0** | Fail-open API Gamma | Remplacer `return true` par `return false` dans le catch | 5 min |
| **P0** | Race condition janitor | Fusionner `disableResolved` + `runAutoTrackCycle` dans le même cycle | 15 min |
| **P1** | Tri non-déterministe | Ajouter tie-breaker `volume24hr` | 5 min |
| **P1** | Format question fragile | Ajouter patterns alternatifs pour `up-down` | 10 min |
| **P2** | Duplication API | Fusionner `hasActiveSelectionForRule` et `discoverCurrentMarket` | 30 min |
| **P2** | Mapping interval statique | Valider intervalles supportés côté frontend | 15 min |

---

## 8. FLUX COMPLET RECOMMANDÉ

```
[Utilisateur active "Bitcoin 5m"]
       │
       ▼
[POST /api/algo/auto-track]
       │
       ├─ createRule("Bitcoin", "5m")
       │
       └─ discoverAndAddMarket("Bitcoin", "5m")
              │
              ├─ hasActiveSelectionForRule() → false (aucun marché)
              │
              ├─ discoverCurrentMarket("Bitcoin", "5m")
              │      │
              │      ├─ INTERVAL_TAG_SLUG['5m'] → '5M'
              │      ├─ GET /events?tag_slug=5M&active=true&limit=50
              │      ├─ Filtrer: cryptoSymbol=Bitcoin, category=up-down, active
              │      ├─ Trier: startDate asc + volume24hr desc
              │      └─ Retourner: conditionId du premier
              │
              ├─ addSelection(conditionId, { Bitcoin, 5m })
              │
              └─ emitAlgoMarketsChanged() → WebSocket → Frontend
                     │
                     ▼
              [Carousel affiche le nouveau marché Bitcoin 5m]
```

---

## 9. CONCLUSION

Le système de surveillance Up/Down est **fonctionnel** mais présente des **faiblesses de conception** qui le rendent fragile face aux changements de l'API Polymarket.

**Points forts :**
- Architecture claire (frontend → backend → worker → API externe)
- WebSocket temps réel pour les prix
- Découverte immédiate des marchés

**Points faibles :**
- Dépendance au format exact des questions Polymarket
- Gestion d'erreur API trop permissive (fail-open)
- Race condition entre les deux janitors
- Tri non-déterministe

**Recommandation :** Corriger les 2 problèmes P0 (fail-open et race condition) immédiatement, puis les P1 dans la prochaine itération.

---

*Rapport généré par ProjectManager-Agent*
