# Métriques de marché — inventaire, lacunes et pistes d'enrichissement

**Date** : 11 juillet 2026  
**Statut** : note de référence (inventaire + roadmap métriques)

Ce document décrit les **données métriques qu'un marché Polymarket expose** via les APIs
externes (Gamma, CLOB, Data API), ce que **Polywatch collecte, persiste et expose**,
ce qui **manque** par rapport aux sources officielles, et les **métriques additionnelles**
qu'il serait pertinent d'agréger — en priorisant l'exécution (copy-trading, algo crypto,
gestion du risque).

> **Distinction importante** : ce document porte sur les **métriques de marché** (prix,
> liquidité, volume, carnet, historique). Les **métriques Prometheus opérationnelles**
> (positions, compteurs SL/TP, cycle stratégie) sont documentées séparément dans
> [`metrics.md`](./metrics.md).

---

## 1. Sources de données externes

Polywatch s'appuie sur quatre sources Polymarket et un overlay optionnel CoinGecko.

| Source | URL par défaut | Rôle principal |
|--------|----------------|----------------|
| **Gamma API** | `https://gamma-api.polymarket.com` | Métadonnées, listing, tags, volume, liquidité, prix implicites |
| **CLOB REST** | `https://clob.polymarket.com` | Carnet d'ordres, tick size, historique prix, fees, settlement |
| **CLOB WebSocket** | `wss://ws-subscriptions-clob.polymarket.com/ws/market` (+ `/ws/user`) | Book live, top-of-book, dernier trade, résolution ; fills/ordres utilisateur |
| **Data API** | `https://data-api.polymarket.com` | Positions traders, activité, leaderboard, open interest, trades récents |
| **CoinGecko** | `https://api.coingecko.com/api/v3` | Spot USD de l'actif sous-jacent (marchés crypto Up/Down, panneau métriques) |

Variables d'environnement : voir [`configuration.md`](./configuration.md) (`POLYMARKET_*`).

### Fichiers code de référence

| Rôle | Chemin |
|------|--------|
| Entité marché (DB) | `packages/core/src/entities/Market.ts` |
| Parsing Gamma / CLOB | `packages/core/src/polymarket/market-metadata.ts` |
| Listing marchés | `packages/core/src/polymarket/market-list.ts` |
| Client CLOB (book) | `packages/core/src/polymarket/api-client.ts` |
| WebSocket carnet | `packages/core/src/polymarket/websocket-book.ts` |
| Cache métriques live | `packages/core/src/polymarket/market-metrics-cache.ts` |
| Historique prix CLOB | `packages/core/src/polymarket/price-history-client.ts` |
| Types partagés | `packages/core/src/types/index.ts` |
| Agrégateur REST metrics | `packages/backend/src/polymarket/market-metrics.ts` |
| Data API (activité) | `packages/backend/src/polymarket/data-api-client.ts` |
| VWAP / liquidité | `packages/core/src/pricing/vwap.ts` |
| Ticks algo enrichis | `packages/core/src/lib/algo-price-tick.types.ts` |
| Analytics simulation par marché | `packages/core/src/types/market-analytics.ts` |

---

## 2. Ce que Polywatch possède aujourd'hui

Polywatch n'est **pas** une base de données marché exhaustive : il optimise la collecte
pour l'**exécution** (copy-trading + algo crypto). Les données sont réparties entre
**PostgreSQL**, **mémoire runtime** (worker / crypto-algo), **cache REST** (15 s) et
**DTOs éphémères** (listing Gamma).

### 2.1 Métadonnées persistées (`markets`)

Champs stockés en base — voir [`modele-donnees.md`](./modele-donnees.md) et
`packages/core/src/entities/Market.ts` :

| Champ | Description |
|-------|-------------|
| `conditionId` | Clé primaire |
| `question`, `slug`, `eventSlug`, `category`, `icon` | Affichage, URL, filtrage |
| `tagSlugs` | Tableau JSON de slugs Gamma (filtre copy) |
| `endDate` | Fin de marché |
| `tokenIdYes`, `tokenIdNo`, `outcomes` | Tokens binaires + `{ label, tokenId, side }[]` |
| `negRisk` | Flag negative-risk |
| `feeRate`, `feeExponent` | Courbe de fees CLOB (`fd.r`, `fd.e`) |
| `active`, `resolved`, `closed`, `acceptingOrders` | Cycle de vie |
| `winningTokenId` | Token gagnant après résolution |
| `marketType` | Classifieur Polywatch (`standard`, `crypto_up_down`, etc.) |
| `updatedAt` | Dernière synchro metadata |

**Non persisté** sur `markets` : `volume`, `volume24hr`, `liquidityClob`, `description`,
`startDate` / `eventStartTime`, `outcomePrices`.

### 2.2 Listing marchés (DTO éphémère, Gamma)

Type `MarketListItemDto` — `packages/core/src/polymarket/market-list.ts`, exposé via
`GET /api/markets` :

- Métadonnées ci-dessus (live Gamma)
- `startDate`, `volume`, `volume24hr`, `liquidityClob`, `outcomePrices`
- `url` (construit depuis les slugs)
- `cryptoSymbol`, `interval`, `cryptoCategory`, `marketType` (classifieur Polywatch)

### 2.3 Métriques REST agrégées

`GET /api/markets/:conditionId/metrics` — type `MarketMetricsDto`
(`packages/core/src/types/index.ts`), résolu par
`packages/backend/src/polymarket/market-metrics.ts` :

| Champ | Source |
|-------|--------|
| `conditionId` | — |
| `volume`, `volume24hr`, `liquidityClob` | Gamma |
| `outcomePrices` | Gamma |
| `openInterest` | Data API `GET /oi?market=` |
| `description`, `icon` | Gamma |
| `fetchedAt` | Horodatage Polywatch |
| `priceHistory` (optionnel) | CLOB `GET /prices-history` |
| `recentTrades` (optionnel) | Data API `GET /trades` (limite 50) |
| `cryptoSpotHistory` (optionnel) | CoinGecko |

**Query params** : `assetId`, `includeHistory`, `cryptoSymbol`, `interval` — voir
[`api.md`](./api.md).

Cache mémoire **15 secondes** côté backend.

### 2.4 Métriques live (mémoire, WebSocket CLOB)

Uniquement pour les assets **souscrits** (positions ouvertes, watchlist, algo, etc.).

**Modèle carnet** — `OrderBook` :

- `assetId`, `bids[]`, `asks[]` (`price`, `size`), `updatedAt`

**Cache top-of-book** — `MarketMetricsCache`
(`packages/core/src/polymarket/market-metrics-cache.ts`) :

- `bestBid`, `bestAsk`, `spreadTop`
- `lastTradePrice`, `lastTradeSize`, `lastTradeTimestamp`
- `conditionId`, `outcome`

**Tick live DTO** — `MarketTick` :

- Champs ci-dessus + `spreadExecutable` (spread VWAP pour qty de référence)

**Mise à jour pourcentages** — `MarketPercentUpdate` (WebSocket `market_pct_update`) :

- `conditionId`, `outcomePrices[]` (mid dérivé du best bid/ask), `updatedAt`

**Prix exécutable calculé** — `ExecutablePrice` / VWAP (`packages/core/src/pricing/vwap.ts`) :

- `executableBidVwap`, `executableAskVwap`, `liquidityStatus` (`ok` / `partial` / `illiquid`)

**Tick PnL position** — `PnlTick` :

- VWAP exécutable, `triggerPnlPercent`, `closurePnlPercent`, `unrealizedPnl`,
  `liquidityStatus`, `bookUpdatedAt`, `bookConnectionHealthy`

### 2.5 Séries temporelles persistées

| Table / entité | Déclencheur | Contenu principal | API / consommateur |
|----------------|-------------|-------------------|-------------------|
| `market_position_ticks` | Book update throttlé 500 ms, **si position copy/weather ouverte** sur l'asset (positions crypto-algo `ALGO_*` exclues — voir `algo_price_ticks`) | bid/ask/mid/spread/VWAP ref qty, `lastTradePrice` | `GET /api/copied-positions/:id/ticks`, `GET /api/markets/:conditionId/ticks` |
| `market_price_ticks` | Sync CLOB `/prices-history` (non-crypto) via `MarketPriceHistorySyncer` | Souvent `midPrice` seul ; bid/ask/spread souvent `null` | `GET /api/market-chart/:conditionId` |
| `market_price_history_sync` | Registre de synchro | `lastPointTs`, `syncStatus`, `nextSyncAt`, etc. | Worker backfill |
| `algo_price_ticks` | 1 Hz pendant surveillance algo crypto | Métriques les plus riches (voir § 2.6) | `GET /api/algo/market-chart/:conditionId`, WS `algo_chart_tick` |
| `algo_surveillance_snapshots` | Fin de cycle algo | OHLC open/close, `winningOutcome`, positions figées | Rapports / analyse |

> **Répartition des ticks live** : `market_position_ticks` sert le **copy trading** et
> **weather-algo** (BBO lié à une `CopiedPosition`). Les positions **crypto-algo**
> (`reason` préfixé `ALGO_`) n'y écrivent pas — leur série BBO+VWAP+signal est déjà
> dans `algo_price_ticks` (`PriceTickRecorder`, ~1 Hz). Le filtre est dans
> `MarketTickRecorder` (`packages/worker/src/processors/market-tracking/market-tick-recorder.ts`)
> via `isAlgoPositionReason`.

> **Note historique** : les marchés non-crypto ne sont plus enregistrés en live à 1 Hz.
> La décision et l'implémentation sont documentées dans
> [`../archives/v1/v1-1/2026-07-07_brainstorm_market_ticks_vs_polymarket.md`](../archives/v1/v1-1/2026-07-07_brainstorm_market_ticks_vs_polymarket.md).
> Le worker utilise `MarketPriceHistorySyncer` (`packages/worker/src/processors/market-tracking/market-price-history-syncer.ts`).

### 2.6 Métriques algo crypto (`algo_price_ticks`)

Type `AlgoPriceTickMetricsDto` — `packages/core/src/lib/algo-price-tick.types.ts` :

| Catégorie | Champs |
|-----------|--------|
| Prix | `upPrice`, `downPrice`, `upBid/Ask`, `downBid/Ask`, `up/downAskVwap` |
| Spread / liquidité | `up/downSpreadPct`, `up/downLiquidityStatus`, `priceGap`, `bookStalenessMs`, `wsHealthy` |
| Depth (top niveau) | `up/downBidSize`, `up/downAskSize` |
| Dernier trade | `up/downLastTradePrice`, `up/downLastTradeSize` |
| Delta | `upDelta1s`, `downDelta1s` |
| Cycle | `secondsUntilEnd` |
| Portfolio Polywatch | `openPositionsCount`, `openExposureUsd`, `unrealizedPnl` |
| Signaux algo | `lastSignalOutcome`, `lastSignalConfidence`, `lastSignalStrategyId`, `signalAgeMs`, `lastAbstainReason` |

### 2.7 Analytics internes Polywatch (pas Polymarket)

- **Simulation par marché** : `MarketAnalyticsRow` — PnL, ROI, win rate, durée de détention,
  breakdown close reason / outcome — dérivé des **positions copiées**, pas des stats marché
  Polymarket (`GET /api/simulation/analytics/market`).
- **Slippage moyen** : calculé dans `algo-events.service.ts` à partir des exécutions
  (`referenceVwap` vs prix de fill).
- **Latence CLOB** : échantillons `clob_latency_samples` (RTT ordres FAK réels, calibration sim).
- **Prometheus** : métriques opérationnelles globales — voir [`metrics.md`](./metrics.md).

---

## 3. Ce que le CLOB et les APIs Polymarket retournent

### 3.1 CLOB REST

| Endpoint | Champs lus par Polywatch |
|----------|--------------------------|
| `GET /book?token_id=` | `bids[]`, `asks[]`, `min_order_size` |
| `GET /tick-size?token_id=` | `minimum_tick_size` |
| `GET /prices-history?market=` | `history[]` `{ t, p }` ; params `interval`, `startTs`, `endTs`, `fidelity` |
| `GET /markets/{conditionId}` | `condition_id`, `question`, slugs, `end_date_iso`, `neg_risk`, `tokens[]`, lifecycle, `events` |
| `GET /clob-markets/{conditionId}` | `fd.r`, `fd.e` (et `fd.to` visible en tests, non stocké) |
| `POST /order` | `orderID`, `status`, `takingAmount`, `makingAmount` |

### 3.2 CLOB WebSocket — canal marché

Événements consommés (`packages/core/src/polymarket/websocket-book.ts`) :

| Événement | Champs |
|-----------|--------|
| `book` | `asset_id`, `market`, `bids`, `asks` |
| `price_change` | `market`, `price_changes[]` : `asset_id`, `price`, `size`, `side`, `best_bid`, `best_ask` |
| `best_bid_ask` | `asset_id`, `market`, `best_bid`, `best_ask`, `spread` |
| `last_trade_price` | `asset_id`, `market`, `price`, `size`, `timestamp` |
| `market_resolved` | `market`, `condition_id` |

### 3.3 CLOB WebSocket — canal utilisateur (trading réel)

`packages/worker/src/clob/ws-user-events.ts` :

| Événement | Champs |
|-----------|--------|
| `trade` | `id`, `taker_order_id`, `asset_id`, `side`, `size`, `price`, `status` |
| `order` | `id`, `asset_id`, `side`, `price`, `original_size`, `size_matched`, `type` |

### 3.4 Gamma API

Champs parsés (`parseGammaMarketRecord`, `market-list.ts`) :

- Identité : `conditionId`, `question`, `slug`, `endDate`, `eventStartTime`
- Tokens : `clobTokenIds`, `outcomes`, `outcomePrices`
- Lifecycle : `negRisk`, `active`, `resolved`, `closed`, `acceptingOrders`
- Marché : `category`, tags, `volume`, `volume24hr`, `liquidityClob`, `description`, `icon`, `events[]`

Endpoints utilisés : `/markets`, `/markets/keyset`, `/events`, `/events/slug/{slug}`, `/public-profile`.

### 3.5 Data API

| Endpoint | Usage Polywatch |
|----------|-----------------|
| `GET /positions` | Positions d'un trader (copy-trading, trader insight) |
| `GET /value` | Valeur portfolio |
| `GET /activity` | Activité trader (`DataApiActivity` complet) |
| `GET /v1/leaderboard` | Classement traders |
| `GET /oi?market=` | Open interest (snapshot) |
| `GET /trades?market=` | Derniers trades (`timestamp`, `price`, `size`, `side`) |

---

## 4. Lacunes — ce que Polywatch n'a pas (vs CLOB / APIs)

### 4.1 Gamma — disponible mais non persisté

| Champ Gamma | Statut Polywatch |
|-------------|------------------|
| `volume`, `volume24hr`, `liquidityClob` | Fetch listing/metrics ; **pas en DB** |
| `description` | Metrics API uniquement |
| `eventStartTime` / `startDate` | Listing DTO uniquement |
| `outcomePrices` | Éphémère (listing, metrics, WS mid) |
| `competitive`, variations de prix, commentaires, etc. | **Non parsé / non utilisé** |

### 4.2 CLOB — lu mais non conservé

| Capacité CLOB | Lacune |
|---------------|--------|
| Carnet complet multi-niveaux | Mémoire live uniquement ; pas d'historique de depth |
| `min_order_size`, `minimum_tick_size` | Fetch à l'ordre ; **non persisté** par marché |
| `/prices-history` haute fidélité | Défaut ~1 point/heure (`fidelity=60`) hors sync expiration |
| `fd.to` (paramètre fee curve) | Non stocké |
| Rewards market-maker, rebates | Non intégré |
| Book WS hors abonnement | Aucune collecte passive globale |

### 4.3 Data API — sous-exploité côté marché

| Donnée | Lacune |
|--------|--------|
| Tape de trades complète | Max 50 trades via metrics ; **pas de stockage** |
| OI historique | Snapshot unique |
| Distribution holders | Non fetché |
| Activity feed par marché | Activity utilisée par trader, pas agrégée par marché |
| Leaderboard | Trader-centric, pas market-centric |

### 4.4 Limitations structurelles

| Limitation | Détail |
|------------|--------|
| Ticks live non-crypto | Historique CLOB hourly ; bid/ask souvent absents dans `market_price_ticks` |
| Purge `market_price_ticks` | Non implémentée (`modele-donnees.md`) |
| `market_position_ticks` | Uniquement si Polywatch a des positions copy/weather ouvertes (pas `ALGO_*`) |
| Latences CLOB/Data API (Prometheus) | Déclarées dans `metrics.ts` mais **non instrumentées** (`metrics.md`) |
| Spot externe | CoinGecko overlay metrics ; non stocké en DB |
| Analytics « marché » | Stats PnL = **portfolio Polywatch**, pas stats marché Polymarket |

### 4.5 Matrice synthétique

| Catégorie | Polywatch a | APIs ont en plus |
|-----------|-------------|------------------|
| Métadonnées | Core en DB | Description, social, tags riches, startDate |
| Prix implicites | Mid live + Gamma outcomePrices | Multi-outcome, cross-check AMM/CLOB |
| Volume / liquidité | Cache 15 s | Variantes 24h, score `competitive` |
| Carnet | Top-of-book + VWAP (mémoire + ticks partiels) | Depth complet, historique, tous tokens |
| Trades | 50 derniers (optionnel) | Tape complète, maker/taker, tx hash |
| Open interest | Point-in-time | Courbes historiques |
| Historique prix | Hourly (non-crypto), 1 Hz (algo) | Fidelity arbitraire CLOB |
| Fees | `feeRate` + `feeExponent` | Courbe complète (`fd.to`), rewards |
| Résolution | Flags + `winningTokenId` | Détails on-chain, UMA / dispute |

---

## 5. Métriques additionnelles recommandées

Polywatch peut enrichir sa couche métriques sans viser une réplique complète de
Polymarket. L'objectif est des métriques **actionnables pour l'exécution**.

### 5.1 Quick wins — données déjà là, peu exposées

| Métrique | Source actuelle | Intérêt |
|----------|-----------------|---------|
| `startDate` / `eventStartTime` | Gamma (listing) | Fenêtre de trading, time-to-expiry, auto-track |
| `volume`, `volume24hr`, `liquidityClob` | Gamma (metrics) | Scoring marché, tri auto-track |
| `minimum_tick_size`, `min_order_size` | CLOB | Validation ordres, arrondi prix |
| `bestBid/Ask`, `spreadTop`, `spreadPercent` | WS + `market_position_ticks` | UI non-crypto — plan [`plans/2026-07-07_PLAN_ENRICHIR_DIALOGUE_NON_CRYPTO.md`](../plans/applied/2026-07-07_PLAN_ENRICHIR_DIALOGUE_NON_CRYPTO.md) |
| `bookStalenessMs`, `wsHealthy` | Algo ticks | Qualité du mark SL/TP sur **tous** les marchés suivis |
| Depth top niveau (`bidSize` / `askSize`) | Algo ticks | Généralisable au copy-trading |
| Slippage réel vs `referenceVwap` | Exécutions | Qualité d'exécution par marché / trader |

**Effort** : faible — persistance volume/liquidité sur `markets`, extension `MarketMetricsDto`,
généralisation des métriques algo vers copy-trading.

### 5.2 Métriques dérivées du carnet (calcul interne)

| Métrique | Calcul | Usage |
|----------|--------|-------|
| Depth à qty de référence | Somme des niveaux jusqu'à `MARKET_TICK_REF_QTY` (100) | Faisabilité entrée/sortie |
| Depth ratio bid/ask | `bidDepth / askDepth` | Déséquilibre du carnet |
| Spread exécutable % | `(askVwap - bidVwap) / mid` | Plus pertinent que spread top-of-book |
| Impact estimé | VWAP(qty) vs mid | Pré-trade check |
| Illiquidity score | Composite spread + depth + staleness + `liquidityStatus` | Gate d'entrée unifiée |
| Mark quality | Âge last trade, âge book, `wsHealthy` | Fiabilité PnL / SL |
| Price gap Up/Down | Déjà en algo (`priceGap`) | Incohérence binaire |

### 5.3 Nouvelles sources externes

**Gamma** : `competitive`, variations prix 1h/24h/7j, métadonnées sociales (optionnel).

**Data API** :

- Trade velocity (trades/min, volume/min) via `/trades` élargi
- VWAP marché sur fenêtre glissante
- Snapshots OI périodiques (courbe légère)
- Activity agrégée par marché (si endpoint disponible)

**CLOB** :

- `/prices-history` haute fidélité pour séries spread/bid/ask
- Fee effectif au prix courant (`fd.to`)
- Rewards market-maker (coût d'exécution)

### 5.4 Métriques « portfolio Polywatch × marché » (valeur unique)

Données que Polymarket ne fournit pas mais que Polywatch possède déjà :

| Métrique | Source | Usage |
|----------|--------|-------|
| Exposition nette par marché | `copied_positions` | Risque concentré |
| Exposition par outcome YES/NO | Positions + book | Hedge implicite |
| PnL mark vs PnL closure | `triggerPnl` vs `closurePnl` | Qualité sorties SL/TP |
| Taux de fill partiel | `executions` (`partial`) | Marchés à éviter |
| Latence signal → fill | `move_events` → `executions` | Performance copy |
| Copy lag | `detectedAt` vs trade trader | Avantage compétitif perdu |
| Close reason × spread marché | Analytics + ticks | Corréler `no_liquidity` / `slippage_exceeded` |
| Self-impact (sim) | `self-impact-registry` | Impact de ses ordres sur le book |
| Traders actifs (watchlist) | Move events | Qui trade ce marché dans Polywatch |

### 5.5 Séries temporelles légères (agrégats)

Alternative au stockage du carnet complet :

| Série | Granularité suggérée |
|-------|---------------------|
| Spread top + exécutable | 1 min / 5 min |
| Mid + last trade | 1 min |
| Volume trades (Data API) | 5 min |
| Open interest | 15 min |
| Distribution `liquidityStatus` | Par heure (% ok / partial / illiquid) |

### 5.6 Observabilité ops (plans existants)

Hors scope P0 du plan [`plans/2026-07-05_PLAN_P0_METRIQUES.md`](../plans/applied/2026-07-05_PLAN_P0_METRIQUES.md),
à agréger en P1/P2 :

- Latence CLOB REST / Data API
- Reconnexions WebSocket
- Fraîcheur book par asset
- Taux d'abstention algo par raison (`spread_gate`, `stale_book`, `illiquid_book`, etc.)

---

## 6. Priorisation suggérée

### P0 — impact immédiat sur l'exécution

1. Unifier métriques book (spread, depth top, staleness, VWAP) **hors crypto-algo**
2. Persister `volume24hr` + `liquidityClob` sur les marchés suivis / actifs
3. Exposer slippage, taux de fill, latence signal→fill **par marché**

### P1 — sélection de marché et risque

4. Trade velocity + snapshots OI
5. Exposition nette + mark quality score
6. Impact estimé pré-ordre

### P2 — recherche et analytics

7. Séries spread/liquidité agrégées
8. Tape de trades enrichie (fenêtre glissante)
9. Métadonnées Gamma avancées (`competitive`, price changes)

### À éviter sauf besoin explicite

- **Carnet complet historisé** — volume stockage élevé, faible ROI copy-trading
- **Tape Polymarket intégrale** — redondant avec Data API
- **Métriques sociales Gamma** — hors scope exécution
- **Doublon outcomePrices Gamma vs mid CLOB** — une source de vérité par cas d'usage

---

## 7. Proposition de contrat futur (esquisse)

Pour une implémentation P0, un DTO unifié pourrait ressembler à :

```typescript
interface MarketExecutionMetricsDto {
  conditionId: string;
  assetId: string;

  // Marché (Gamma / Data API, refresh périodique)
  volume24hr?: number;
  liquidityClob?: number;
  openInterest?: number;
  tradeVelocity5m?: number;   // P1

  // Carnet live (WS + VWAP)
  bestBid?: number;
  bestAsk?: number;
  spreadTop?: number;
  spreadExecutablePct?: number;
  depthBidAtRefQty?: number;
  depthAskAtRefQty?: number;
  liquidityStatus?: 'ok' | 'partial' | 'illiquid';
  bookStalenessMs?: number;
  wsHealthy?: boolean;

  // Portfolio Polywatch (P0/P1)
  openExposureUsd?: number;
  openPositionsCount?: number;
  avgSlippagePct?: number;    // fenêtre glissante
  partialFillRate?: number;

  fetchedAt: string;
}
```

Ce contrat n'existe pas encore en code ; il formalise la cible documentaire.

---

## 8. Documents liés

| Document | Lien |
|----------|------|
| Modèle de données (tables ticks) | [`modele-donnees.md`](./modele-donnees.md) |
| Routes API marché / metrics / charts | [`api.md`](./api.md) |
| Métriques Prometheus (ops) | [`metrics.md`](./metrics.md) |
| Module crypto-algo (ticks enrichis) | [`crypto-algo.md`](./crypto-algo.md) |
| Décision ticks non-crypto vs Polymarket | [`../archives/v1/v1-1/2026-07-07_brainstorm_market_ticks_vs_polymarket.md`](../archives/v1/v1-1/2026-07-07_brainstorm_market_ticks_vs_polymarket.md) |
| Enrichissement UI graphique non-crypto | [`plans/2026-07-07_PLAN_ENRICHIR_DIALOGUE_NON_CRYPTO.md`](../plans/applied/2026-07-07_PLAN_ENRICHIR_DIALOGUE_NON_CRYPTO.md) |
| Plan métriques Prometheus P0 | [`plans/2026-07-05_PLAN_P0_METRIQUES.md`](../plans/applied/2026-07-05_PLAN_P0_METRIQUES.md) |
| Architecture worker (sync historique) | [`architecture.md`](./architecture.md) |

---

## 9. Synthèse

Polywatch est optimisé pour le **copy-trading et l'algo crypto**, pas pour la recherche
marché exhaustive. Il **persiste** le lifecycle et les fees, **maintient en live** le
top-of-book et le VWAP pour les assets souscrits, **enregistre** des ticks positionnels
et un historique prix hourly (non-crypto) ou 1 Hz (algo), et **fetch à la demande**
volume, liquidité, OI et trades récents.

Le CLOB et les APIs Polymarket exposent substantiellement plus (carnet complet, tape
intégrale, OI historique, métadonnées riches, rewards). La roadmap métriques la plus
rentable consiste à **agréger ce que Polywatch voit déjà** — carnet, exécutions,
positions, traders — en indicateurs **exécution-centric** : liquidité réelle, qualité
du mark, slippage, exposition et santé temporelle du marché.
