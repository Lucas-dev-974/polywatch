# Audit — Enregistrement des ticks de marché non-crypto

**Polywatch v1.1**
**Date :** 2026-07-06
**Périmètre :** `MarketPositionTick`, `MarketTickRecorder`, `MarketPositionTickService`, `MarketChartDialog`
**Auteur :** Audit architecture — analyse du flux de données marché
**Statut :** ✅ Résolu — patch implémenté le 2026-07-06

---

## 1. Résumé exécutif

Le système actuel d'enregistrement des ticks de marché pour les positions **non-crypto** (sport, politique, etc.) présente un **défaut de conception** : les données sont enregistrées par **position** (`copiedPositionId`) au lieu de par **marché** (`conditionId`). Cela entraîne :

| Problème | Gravité | Impact |
|----------|:-------:|--------|
| Duplication de données | 🔴 Élevé | N lignes identiques pour N positions sur le même marché |
| Trous dans l'historique | 🔴 Élevé | Plus de ticks dès que la dernière position est fermée |
| Pas d'historique pré-position | 🔴 Élevé | Impossible de voir le marché avant d'entrer |
| Incompatible avec MarketChartDialog | 🔴 Bloquant | Le dialog attend des données par conditionId, pas par position |
| Fréquence irrégulière | 🟡 Moyen | Dépend des mises à jour WS, pas d'un timer fixe |

**Verdict :** Le `MarketPositionTick` est conçu pour le **suivi individuel de position** (PnL, évolution du prix pendant la durée de vie). Il manque un équivalent de `AlgoPriceTick` pour les marchés non-crypto : un enregistrement **par conditionId**, **timer-based**, **indépendant des positions**.

---

## 2. Architecture actuelle

### 2.1 Flux des données

```
WebSocket Polymarket (book update)
        │
        ▼
MarketMetricsCache (mémoire, par assetId)
        │
        ▼
MarketTickRecorder.handleBookUpdate(assetId)
        │
        ├── Vérifie : positions ouvertes sur cet asset ?
        │       └── Non → STOP (aucun tick enregistré)
        │
        ├── Vérifie : throttle écoulé ? (marketTickThrottleMs)
        │       └── Non → STOP
        │
        └── Oui → recordBatch() → market_position_ticks
                │
                └── 1 ligne × N positions ouvertes
```

### 2.2 Entité `MarketPositionTick`

```typescript
@Entity('market_position_ticks')
export class MarketPositionTick {
  id: number;
  copiedPositionId: number;    // ← Clé primaire fonctionnelle : par position
  conditionId: string;          // ← Redondant : N lignes avec le même conditionId
  assetId: string;
  outcome: string;
  bestBid: number;              // ← Identique pour toutes les positions du même marché
  bestAsk: number;              // ← Identique pour toutes les positions du même marché
  midPrice: number;             // ← Identique
  spread: number;               // ← Identique
  spreadPercent: number;        // ← Identique
  executableBidVwap: number | null;
  executableAskVwap: number | null;
  lastTradePrice: number | null;
  createdAt: Date;
}
```

### 2.3 Comparaison avec AlgoPriceTick (crypto)

| Aspect | `AlgoPriceTick` (crypto) | `MarketPositionTick` (non-crypto) |
|--------|--------------------------|-----------------------------------|
| **Granularité** | Par `conditionId` | Par `copiedPositionId` |
| **Déclencheur** | Timer 1s (`PriceTickRecorder`) | Événementiel (book update WS) |
| **Indépendant des positions** | ✅ Oui | ❌ Non |
| **Historique complet** | ✅ Oui (1 tick/s, 24h) | ❌ Trous (trou uniquement quand position ouverte) |
| **Données avant position** | ✅ Oui | ❌ Non |
| **Données après fermeture** | ✅ Oui | ❌ Non |
| **Duplication** | 1 ligne = 1 tick | N lignes = 1 tick × N positions |
| **Fréquence** | Fixe (1 Hz) | Variable (dépend du marché) |

---

## 3. Problèmes détaillés

### 🔴 P1 — Duplication de données

Si 3 positions sont ouvertes sur le même marché sportif, chaque mise à jour du carnet écrit **3 lignes identiques** :

```
copiedPositionId=101, conditionId=0xABC, bestBid=0.45, bestAsk=0.55, midPrice=0.50
copiedPositionId=102, conditionId=0xABC, bestBid=0.45, bestAsk=0.55, midPrice=0.50  ← doublon
copiedPositionId=103, conditionId=0xABC, bestBid=0.45, bestAsk=0.55, midPrice=0.50  ← doublon
```

**Impact :** Stockage ×3 pour zéro information supplémentaire. Avec 10 positions sur le même marché → ×10.

### 🔴 P2 — Trous dans l'historique

Dès que la **dernière position** est fermée, `OpenPositionTracker.getPositions(assetId)` retourne `[]` → `handleBookUpdate` ne fait rien → **plus aucun tick enregistré**, même si le marché continue de trader.

**Impact :** L'historique s'arrête brutalement. Impossible de voir l'évolution du marché après la sortie.

### 🔴 P3 — Pas d'historique pré-position

Si une position est ouverte à 14h00, les ticks commencent à 14h00. Rien avant.

**Impact :** Impossible de voir la tendance du marché avant d'entrer en position.

### 🔴 P4 — Incompatible avec MarketChartDialog

Le `MarketChartDialog` utilise `GET /api/algo/market-chart/:conditionId` qui lit `algo_price_ticks` par `conditionId`. Pour les marchés non-crypto :

- `positionToMarketChartContext()` retourne **null** (car `isUpDownCryptoMarket()` = false)
- Le bouton "Cours Marché" est **caché** pour toutes les positions non-crypto
- Aucune route équivalente n'existe pour `market_position_ticks` par `conditionId`

**Impact :** Les utilisateurs ne peuvent pas voir le graphique de prix pour les marchés sportifs, politiques, etc.

### 🟡 P5 — Fréquence irrégulière

Le throttle `marketTickThrottleMs` limite à 1 tick par période, mais la fréquence réelle dépend entièrement du flux WebSocket Polymarket. Sur un marché calme, il peut y avoir 1 tick toutes les 30 secondes. Sur un marché actif, 10 ticks par seconde.

**Impact :** Le graphique a une résolution variable et peu fiable.

---

## 4. Cause racine

Le `MarketPositionTick` a été conçu pour répondre à un besoin légitime : **suivre l'évolution du prix d'un marché pendant la durée de vie d'une position individuelle**. C'est utile pour :

- Calculer le PnL instantané par position
- Afficher l'évolution du prix dans le détail d'une position
- Analyser le drawdown d'une position spécifique

**Mais** ce modèle a été **détourné** pour servir de source de données marché globale, ce qu'il n'est pas. Il manque un **modèle orienté marché** pour les non-crypto, à l'image de `AlgoPriceTick` pour le crypto.

---

## 5. Solution proposée

### 5.1 Nouvelle entité : `MarketPriceTick`

```typescript
@Entity('market_price_ticks')
@Index(['conditionId', 'recordedAt'])
export class MarketPriceTick {
  id: number;
  conditionId: string;
  assetId: string;
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  spread: number | null;
  spreadPercent: number | null;
  executableBidVwap: number | null;
  executableAskVwap: number | null;
  lastTradePrice: number | null;
  recordedAt: Date;
  createdAt: Date;
}
```

**Différence clé avec `MarketPositionTick` :** Pas de `copiedPositionId`, pas d'`outcome`. Une ligne = un tick pour un marché, point.

### 5.2 Nouveau service : `MarketPriceTickService`

Calqué sur `AlgoPriceTickService` :
- `recordTick(input)` — 1 tick pour 1 conditionId
- `listTicks(conditionId, options?)` — ticks par conditionId
- `deleteOlderThan(maxAgeMs)` — purge

### 5.3 Nouveau recorder : `MarketPriceTickRecorder`

Dans le worker, un **timer** (configurable, défaut 1s) qui :
1. Récupère la liste des marchés suivis (positions ouvertes + algo selections)
2. Pour chaque marché, lit le `MarketMetricsCache` (bid/ask/mid)
3. Enregistre 1 ligne dans `market_price_ticks`

**Indépendant des positions :** même si aucune position n'est ouverte, le timer continue d'enregistrer les prix des marchés suivis.

### 5.4 Nouvelle route backend

```typescript
GET /api/market-chart/:conditionId
```

Calquée sur `algo-market-chart.ts`, mais lit `market_price_ticks` au lieu de `algo_price_ticks`.

### 5.5 Frontend : `positionToMarketChartContext` étendu

Supprimer le filtre `isUpDownCryptoMarket()` dans `positionToMarketChartContext()`. Toute position avec un `conditionId` peut ouvrir le dialog "Cours Marché". Le dialog utilisera la nouvelle route pour les non-crypto.

---

## 6. Comparaison avant/après

| Scénario | Avant | Après |
|----------|-------|-------|
| 3 positions sur le même marché | 3 lignes/tick (×3 stockage) | 1 ligne/tick |
| Marché sans position ouverte | 0 tick enregistré | Timer continue (1 tick/s) |
| Position fermée → historique | Trou à partir de la fermeture | Historique complet jusqu'à la fin du suivi |
| Dialog "Cours Marché" pour sport | ❌ Bouton caché | ✅ Graphique disponible |
| Route API pour non-crypto | ❌ Aucune | ✅ `GET /api/market-chart/:conditionId` |

---

## 7. Rétrocompatibilité

- `MarketPositionTick` et `MarketPositionTickService` **ne sont pas supprimés** — ils continuent de servir pour le suivi individuel de position
- `MarketTickRecorder` continue d'enregistrer les `MarketPositionTick` comme avant
- Le nouveau `MarketPriceTickRecorder` est **additif** — il ne remplace rien
- La migration est **zero-downtime** : nouvelle table, nouveau service, nouveau timer

---

## 8. Estimation d'effort

| Composant | Effort | Fichiers |
|-----------|--------|----------|
| Entité `MarketPriceTick` | 15 min | 1 nouveau fichier |
| Migration `CreateMarketPriceTicks` | 10 min | 1 nouveau fichier |
| Service `MarketPriceTickService` | 20 min | 1 nouveau fichier |
| Recorder `MarketPriceTickRecorder` | 30 min | 1 nouveau fichier |
| Route `GET /api/market-chart/:conditionId` | 15 min | 1 nouveau fichier |
| Frontend : étendre `positionToMarketChartContext` | 10 min | 1 fichier modifié |
| Tests | 30 min | 3-4 fichiers |
| **Total** | **~2h** | **6-8 fichiers** |

---

*Rapport généré par analyse manuelle du code — Polywatch v1.1 — juillet 2026.*
