# Brainstorm : Remplacer `MarketPriceTick` par l'historique Polymarket

**Date :** 2026-07-07  
**Auteur :** Agent Hermes  
**Statut :** **Implémenté** (2026-07-07) — **v2 : Dialog de configuration UI + nettoyage code mort** (2026-07-07) — **v3 : Patch gap rédemption** (2026-07-07)  
**Contexte :** Conversation du 2026-07-07 suite à la validation du dialog "Cours Marché" pour les marchés non-crypto.

---

## Résumé exécutif

| Élément | Décision / état |
|---------|-----------------|
| **Approche retenue** | Sync Polymarket → BDD locale (pas de proxy pur, pas de timer 1s) |
| **Endpoint** | `GET /prices-history` (CLOB API) |
| **Granularité** | 1 point/heure (`fidelity=60`) en sync normal ; 1 point/min à l'expiration |
| **Déclencheurs** | Ouverture position non-crypto, refresh positions, cycle horaire, expiration marché, backfill on-demand (graphique) |
| **Marchés crypto** | Exclus (`isUpDownCryptoMarket`) — conservent `AlgoPriceTick` |
| **Table locale** | `market_price_ticks` conservée comme cache ; registre `market_price_history_sync` pour le suivi |
| **Build** | `core`, `backend`, `worker`, `frontend` compilent |

---

## Décision prise

Après investigation, l'endpoint **`GET https://clob.polymarket.com/prices-history`** fournit un historique de prix utilisable pour les marchés non-crypto.

**Option retenue : variante de l'Option 3 (hybridation), orientée sync local**

- ❌ **Abandon** du timer 1s (`MarketPriceTickRecorder`) — trop coûteux, historique incomplet au démarrage
- ❌ **Abandon** du proxy pur (Option 4) — dépendance API à chaque affichage, pas de registre de sync
- ✅ **Sync Polymarket → `market_price_ticks`** — le backend lit toujours la BDD locale (contrat API inchangé pour le frontend)
- ✅ **Registre de sync** (`market_price_history_sync`) — suivi incrémental, expiration, réconciliation
- ✅ **Service partagé** (`MarketPriceHistoryBackfillService`) — chemin unique worker + backend

**Pourquoi conserver une table locale ?**

- Affichage instantané du graphique (SELECT local vs appel Polymarket à chaque requête)
- Résilience si Polymarket est temporairement indisponible (données déjà syncées)
- Contrat frontend/backend stable (`GET /api/market-chart/:conditionId?assetId=...`)

---

## Architecture implémentée (2026-07-07)

### Composants

| Composant | Rôle |
|-----------|------|
| `fetchPriceHistory()` (`core/polymarket/price-history-client.ts`) | Client CLOB `/prices-history` |
| `MarketPriceHistoryBackfillService` (`core`) | Point d'entrée unique : bootstrap, incrémental, réconciliation, lock in-flight |
| `MarketPriceHistorySyncService` (`core`) | CRUD registre `market_price_history_sync` |
| `MarketPriceTickService` (`core`) | `upsertBatch`, `listTicks`, `getLatestTickTs`, purge |
| `MarketPriceHistorySyncer` (`worker`) | Cycle horaire, sync expiration, `bootstrapTrackedPositions()` |
| `GET /api/market-chart/:conditionId` (`backend`) | Lit BDD ; backfill on-demand via service partagé si vide |
| `MarketChartDialog` (`frontend`) | Inchangé côté contrat ; propage `assetId` dans la chaîne API |

### Flux de données

```
Polymarket CLOB GET /prices-history
    ↓
MarketPriceHistoryBackfillService.ensureHistorySynced()
    ↓ upsertBatch (orIgnore, unique condition_id+asset_id+recorded_at)
market_price_ticks  ←── SELECT ── GET /api/market-chart/:conditionId?assetId=
    ↓
Frontend MarketChartDialog
```

### Déclencheurs de sync

| Moment | Mécanisme |
|--------|-----------|
| Démarrage worker | `bootstrapTrackedPositions(openPositionTracker)` |
| Nouvelle position ouverte | Idem, à chaque refresh du tracker (intervalle `BOOK_SUBSCRIPTION_SYNC_MS`) |
| Cycle horaire | `MarketPriceHistorySyncer.runHourlySync()` — configurable via UI |
| Marché expiré | `runExpirationSync()` — fidelity configurable via UI, statut `terminal` |
| Graphique vide | Backend appelle `ensureHistorySynced()` avant relecture |

### Schéma BDD

**`market_price_ticks`** (recréée, migration `1700000000028`)

- Index unique `(condition_id, asset_id, recorded_at)`
- Points Polymarket : `mid_price` rempli, `best_bid`/`best_ask`/`spread` à `null`

**`market_price_history_sync`** (migration `1700000000029`)

- `(condition_id, asset_id)` unique
- `last_point_ts`, `next_sync_at`, `end_date`, `sync_status` (`idle` / `syncing` / `error` / `terminal`)

**`market_sync_config`** (migration `1700000000030`) — single-row, créée au premier accès

| Colonne | Défaut | Description |
|---------|--------|-------------|
| `max_markets_per_cycle` | `10` | Marchés max par cycle horaire |
| `default_fidelity_minutes` | `60` | Résolution sync normale (minutes) |
| `expiration_fidelity_minutes` | `1` | Résolution sync expiration (minutes) |
| `hourly_sync_interval_ms` | `3_600_000` | Intervalle cycle horaire (ms) |
| `expiration_interval_ms` | `60_000` | Intervalle vérification expiration (ms) |
| `tick_retention_days` | `0` | Rétention ticks (0 = pas de purge) |

### Purge

- Configurable via UI (`tickRetentionDays`)
- Timer horaire dans `worker/index.ts` si `retentionDays > 0`

---

## v2 — Dialog de configuration UI (2026-07-07)

### Problème identifié

Les paramètres de synchronisation étaient **hardcodés** dans le code source :
- `MAX_MARKETS_PER_CYCLE = 10` dans `market-price-history-syncer.ts`
- `EXPIRATION_FIDELITY = 1` dans `market-price-history-syncer.ts`
- `EXPIRATION_INTERVAL_MS = 60_000` dans `market-price-history-syncer.ts`
- `DEFAULT_PRICE_HISTORY_FIDELITY = 60` dans `price-history-client.ts`
- `MARKET_PRICE_HISTORY_SYNC_INTERVAL_MS = 3_600_000` dans `price-history-client.ts`

Aucun de ces paramètres n'était modifiable sans redéploiement.

### Solution

1. **Table `market_sync_config`** (migration `1700000000030`) — single-row, créée automatiquement au premier accès
2. **`MarketSyncConfigService`** (`core`) — `getConfig()` / `updateConfig()`
3. **Route `GET/PUT /api/market-sync-config`** (`backend`) — validation Zod, publie `config-changed` sur Redis
4. **`MarketSyncSettingsDialog`** (`frontend`) — dialog avec 3 sections (Cycle horaire, Sync à l'expiration, Nettoyage), scrollable
5. **Bouton "Sync"** dans l'en-tête de la page Marchés
6. **Worker** — `MarketPriceHistorySyncer.start()` devient `async`, lit la config depuis la BDD à chaque cycle

### Fichiers créés/modifiés (v2)

**Core (`packages/core`)**

| Fichier | Action |
|---------|--------|
| `src/entities/MarketSyncConfig.ts` | **Créé** |
| `src/migrations/CreateMarketSyncConfig1700000000030.ts` | **Créé** |
| `src/services/market-sync-config.service.ts` | **Créé** |
| `src/services/market-price-tick.service.ts` | **Modifié** — `recordTick()` et `MarketPriceTickRecordInput` supprimés (code mort) |
| `src/entities/MarketPriceTick.ts` | **Modifié** — JSDoc mise à jour ("timer 1s" → "Polymarket price history sync") |
| `src/database/data-source.ts` | **Modifié** — entité + migration enregistrées |
| `src/services/index.ts` | **Modifié** — export `MarketSyncConfigService`, retrait `MarketPriceTickRecordInput` |
| `src/entities/index.ts` | **Modifié** — export `MarketSyncConfig` |

**Backend (`packages/backend`)**

| Fichier | Action |
|---------|--------|
| `src/routes/market-sync-config.ts` | **Créé** |
| `src/index.ts` | **Modifié** — route enregistrée |

**Worker (`packages/worker`)**

| Fichier | Action |
|---------|--------|
| `src/processors/market-tracking/market-price-history-syncer.ts` | **Modifié** — `start()` async, lecture config BDD, constantes hardcodées supprimées |
| `src/index.ts` | **Modifié** — `await marketPriceHistorySyncer.start()` |

**Frontend (`packages/frontend`)**

| Fichier | Action |
|---------|--------|
| `src/components/MarketSyncSettingsDialog.tsx` | **Créé** |
| `src/lib/market-sync-config.ts` | **Créé** |
| `src/components/MarketsPage.tsx` | **Modifié** — bouton "Sync" + dialog |
| `src/styles.css` | **Modifié** — classe `.dialog-body-scroll` |

---

## v3 — Patch gap rédemption (2026-07-07)

### Problème identifié

Quand un marché est résolu (rédimé) avant sa `end_date`, le `MarketPriceHistorySyncer` continuait de poller Polymarket pour ses prix historiques. Le seul moyen de marquer une entrée `terminal` était :
1. Le cycle horaire (pour les marchés crypto uniquement)
2. `runExpirationSync()` → `syncAtExpiration()` (uniquement si `end_date` est passée)

**Scénario problématique :** un marché résolu 2 jours avant sa `end_date` → le syncer continue de l'appeler pendant 48h, gaspillant des appels API et du stockage.

### Solution — Double approche

**1. Proactive :** `MarketResolutionService.processCondition()` appelle `syncService.markTerminalForCondition(conditionId)` dès qu'un marché est détecté comme résolu (`winningTokenId` présent et `isMarketRedeemable()` true). Cela marque toutes les entrées `market_price_history_sync` du `conditionId` comme `terminal` immédiatement, avant même que le `RedemptionHandler` ne traite les positions.

**2. Défensive :** `findPending()` et `findExpiring()` incluent une sous-requête `NOT EXISTS` contre la table `markets` pour exclure les marchés déjà résolus (`resolved = true` ou `winning_token_id IS NOT NULL`). Cela protège contre :
- Les entrées créées après la résolution du marché (bootstrap tardif)
- Les cas où `markTerminalForCondition()` n'aurait pas été appelé (race condition, redémarrage)

### Fichiers modifiés (v3)

**Core (`packages/core`)**

| Fichier | Action |
|---------|--------|
| `src/services/market-price-history-sync.service.ts` | **Modifié** — ajout `markTerminalForCondition()`, sous-requête `NOT EXISTS` dans `findPending()` et `findExpiring()` |
| `src/services/market-resolution.service.ts` | **Modifié** — injection `MarketPriceHistorySyncService`, appel à `markTerminalForCondition()` dans `processCondition()` |

---

## Fichiers créés, modifiés, supprimés (v1)

### Core (`packages/core`)

| Fichier | Action |
|---------|--------|
| `src/polymarket/price-history-client.ts` | **Créé** — client + constantes |
| `src/services/market-price-history-sync.service.ts` | **Créé** |
| `src/services/market-price-history-backfill.service.ts` | **Créé** — service unifié post-audit |
| `src/services/market-price-tick.service.ts` | **Modifié** — `upsertBatch`, `getLatestTickTs`, `listTicks(assetId?)` |
| `src/entities/MarketPriceHistorySync.ts` | **Créé** |
| `src/migrations/ReplaceMarketPriceTicks1700000000028.ts` | **Créé** |
| `src/migrations/CreateMarketPriceHistorySync1700000000029.ts` | **Créé** |
| `src/database/data-source.ts` | **Modifié** — entité + migrations enregistrées |
| `src/services/index.ts`, `src/polymarket/index.ts` | **Modifié** — exports |

### Worker (`packages/worker`)

| Fichier | Action |
|---------|--------|
| `src/processors/market-tracking/market-price-tick-recorder.ts` | **Supprimé** |
| `src/processors/market-tracking/market-price-history-syncer.ts` | **Créé** puis **refactorisé** (délègue au backfill service) |
| `src/index.ts` | **Modifié** — syncer, bootstrap, purge |
| `src/config.ts` | **Modifié** — `marketPriceTickRetentionDays` |

### Backend (`packages/backend`)

| Fichier | Action |
|---------|--------|
| `src/routes/market-chart.ts` | **Modifié** — `?assetId=`, backfill via service partagé |
| `src/polymarket/market-metrics.ts` | **Modifié** — utilise `fetchPriceHistory` + `DEFAULT_PRICE_HISTORY_FIDELITY` |

### Frontend (`packages/frontend`)

| Fichier | Action |
|---------|--------|
| `PositionMarketChartTrigger.tsx`, `AlgoMarketChartTrigger.tsx` | **Modifié** — propagation `assetId` |
| `MarketChartDialogHost.tsx`, `useMarketChart.ts` | **Modifié** |
| `lib/market-chart.ts`, `lib/position-market-chart.ts` | **Modifié** |
| `api.ts` | **Modifié** — exclusion cache GET `/market-chart` |

---

## Corrections post-audit (`fix_sync_bugs`)

Audit du 2026-07-07 : 5 bugs identifiés sur la première implémentation, tous corrigés via `MarketPriceHistoryBackfillService`.

| Bug | Avant | Après |
|-----|-------|-------|
| `endDate: null` au bootstrap | Passé explicitement depuis `worker/index.ts` | Résolu via `MarketService.loadByConditionIds()` dans le backfill service |
| Pas de filtre crypto au bootstrap | Seul le cycle horaire excluait le crypto | `ensureHistorySynced()` skip crypto dès le bootstrap |
| Double chemin backfill (backend vs worker) | Backend fetch inline sans mettre à jour le registre | Chemin unique `MarketPriceHistoryBackfillService` |
| Concurrence backfill | Appels parallèles possibles | Lock in-flight `Map<conditionId:assetId, Promise>` |
| `upsertBatch` retournait `identifiers.length` | Faux positifs avec `orIgnore()` | Retour `{ attempted: points.length }` |

**Précisions d'architecture retenues :**

1. **Option A** — `ensureHistorySynced()` gère bootstrap, incrémental et réconciliation registre/ticks
2. **`bootstrappedKeys`** — Set interne au syncer (plus dans `worker/index.ts`)
3. **`MARKET_PRICE_HISTORY_SYNC_INTERVAL_MS`** — constante partagée dans core (plus de duplication worker)

---

## Endpoint Polymarket identifié

### CLOB `GET /prices-history`

```
GET https://clob.polymarket.com/prices-history?market=<assetId>&interval=max&fidelity=60
GET https://clob.polymarket.com/prices-history?market=<assetId>&startTs=...&endTs=...&fidelity=60
```

**Réponse :**

```json
{
  "history": [
    { "t": 1720300800, "p": 0.46 },
    { "t": 1720304400, "p": 0.47 }
  ]
}
```

**Contraintes API :**

- `interval` et `startTs`/`endTs` sont **mutuellement exclusifs**
- `fidelity` = résolution en **minutes** (60 → 1 point/heure)
- Retourne `[]` en cas d'erreur réseau ou HTTP (client tolérant)

**Mapping vers `market_price_ticks` :**

| Polymarket | Local |
|------------|-------|
| `p` | `mid_price` |
| `t` (unix sec) | `recorded_at` |
| — | `best_bid`, `best_ask`, `spread` → `null` |

---

## Limites connues et travail restant

| Sujet | Statut |
|-------|--------|
| Granularité 1h vs 1s ancien recorder | Accepté — aligné sur Polymarket, suffisant pour graphique "Cours marché" |
| Pas de spread/bid/ask historique | Limitation API ; graphique affiche `midPrice` uniquement pour l'historique sync |
| `MarketPriceTick.recordTick()` | ✅ **Supprimé** (code mort) |
| JSDoc entité `MarketPriceTick` ("timer 1s") | ✅ **Mise à jour** |
| Paramètres hardcodés (MAX_MARKETS_PER_CYCLE, etc.) | ✅ **Remplacés** par table `market_sync_config` + dialog UI |
| Scrollbar dialog configuration | ✅ **Ajoutée** |
| Gap rédemption : pas de check de rédemption dans `findExpiring()` / `findPending()` | ✅ **Corrigé** (v3) — `markTerminalForCondition()` dans `MarketResolutionService` + sous-requête `NOT EXISTS` dans les deux requêtes |
| Tests unitaires backfill service | Non implémentés (crypto skip, réconciliation, lock) |
| Cache Redis pour `/prices-history` | Non implémenté — sync batch + BDD locale suffisent pour l'instant |
| Rate limiting Polymarket | Non observé en dev ; à monitorer en prod |

---

## Question initiale

> « Pourquoi avoir une table tick marché non crypto (`market_price_ticks`) ?  
> Polymarket délivre des données historiques pour les marchés non-crypto (cf. screenshot graph Polymarket).  
> Ne pourrait-on pas **récupérer directement l'historique Polymarket** au lieu d'enregistrer localement les ticks ? »

**Réponse retenue :** oui, on récupère l'historique Polymarket — mais on le **persiste localement** (sync, pas proxy) pour performance, résilience et contrat API stable.

---

## Contexte historique — architecture avant remplacement (2026-07-06)

> Section conservée pour traçabilité de la réflexion initiale.

| Composant | Rôle | Données |
|-----------|------|---------|
| `MarketPriceTickRecorder` (worker) | Timer 1s, lit le book mémoire | `bestBid`, `bestAsk`, `midPrice`, `spread` |
| `MarketPriceTick` (BDD) | Persiste les ticks par `conditionId` | Table `market_price_ticks` |
| `GET /api/market-chart/:conditionId` (backend) | Lit la BDD locale | Historique local |
| `MarketChartDialog` (frontend) | Affiche le graphique | Données locales |

```
Polymarket WS (book updates)
    ↓
Worker (book mémoire en temps réel)
    ↓ (timer 1s)
MarketPriceTickRecorder → INSERT market_price_ticks
    ↓
Backend GET /api/market-chart → SELECT
    ↓
Frontend
```

**Problèmes qui ont motivé le changement :**

- Pas d'historique avant le premier tick enregistré
- Trous si le worker redémarre
- Stockage croissant sans purge
- Redondance avec les données Polymarket déjà disponibles

---

## Contexte historique — scénarios envisagés

### Scénario A : Endpoint historique public → **Retenu (partiellement)**

L'endpoint `/prices-history` existe. Implémentation = sync local, pas proxy pur.

### Scénario B : Trades seuls → **Rejeté**

Données incomplètes, pas de book continu.

### Scénario C : CDN pré-agrégé → **Non retenu**

API CLOB documentée suffisante ; pas de reverse-engineering CDN.

### Scénario D : Hybridation Polymarket + local → **Retenu (variante sync)**

Sync Polymarket → BDD locale ; pas de double source temps réel (recorder supprimé).

---

## Contexte historique — APIs Polymarket (état investigation)

| API | Historique prix |
|-----|-----------------|
| Gamma (`/markets`) | ❌ Métadonnées seulement |
| CLOB (`/prices-history`) | ✅ **Confirmé** — mid price, fidelity configurable |
| CLOB (`/trades`) | ⚠️ Trades exécutés seulement — insuffisant |
| Data API | ❌ Positions / portfolio |

---

## Bugs rencontrés en implémentation (graphique vide)

Lors des premiers tests (ex. "France vs. Morocco: O/U 3.5"), le graphique affichait *"Pas assez de données..."*.

| Cause | Correction |
|-------|------------|
| `assetId` non propagé dans la chaîne frontend | Propagation `assetId` jusqu'à `GET /market-chart?assetId=` |
| `MarketPriceHistorySync` absent des entités TypeORM | Ajout dans `data-source.ts` |
| Backend fetch inline sans sync préalable | Backfill on-demand via service partagé |
| Cache GET frontend sur réponses vides | Exclusion `/market-chart` du cache GET |

---

## Recommandations finales (post-implémentation)

**Court terme :**

1. ✅ Sync Polymarket implémentée — **done**
2. ✅ Service backfill unifié — **done**
3. ✅ Dialog de configuration UI — **done**
4. ✅ Code mort nettoyé (`recordTick`, JSDoc) — **done**
5. ✅ Gap rédemption corrigé — **done** (v3)
6. 🔍 Valider en prod quelques marchés non-crypto (sport, politique)

**Moyen terme :**

- Tests unitaires `MarketPriceHistoryBackfillService`
- Monitoring : latence Polymarket, taux d'erreur sync, taille table

**Long terme :**

- Évaluer si une granularité plus fine (`fidelity=1`) est nécessaire pour certains cas d'usage
- Cache Redis si rate limiting Polymarket observé

---

**Dernière mise à jour :** 2026-07-07 — v1 implémentation complète + correctifs audit + v2 dialog UI + nettoyage code mort + v3 patch gap rédemption  
**Auteur :** Hermes Agent  
**Statut :** Implémenté
