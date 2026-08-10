# Package `@polywatch/weather-algo` — Trading algorithmique météo

Module d'automatisation pour les marchés **température** Polymarket : sélection
par **ville**, prévisions Open-Meteo multi-modèles, BUY YES sur le palier choisi
par la stratégie active (best-edge ou aligned), sorties drift / bucket / pre-close.

---

## 1. Vue d'ensemble

```
Villes surveillées (WeatherAutoTrackRule)
        │
        ▼
StrategyRunner (poll weatherAlgoPollMs)
        │  1. ExitEvaluator (sorties d'abord)
        │  2. discoverWeatherMarkets + forecast
        │  3. evaluateGroup par stratégie active (catalogue, first-wins)
        │  4. dedupSignalsByCity + applySelectionMode
        ▼
runWeatherEntryPipeline → weather-order-signals
        │
        ▼
worker Executor
```

**Unité de sélection** = ville (+ horizon). **Unité d'exécution** = sous-marché
(palier) choisi automatiquement. **Au plus une position ouverte par ville.**

Positions rattachées à une watchlist sentinelle weather-algo. Snapshot forecast
d'entrée dans `WeatherPositionForecast`. Comme `crypto-algo`, l'adresse
sentinelle n'est pas pollée par le MoveDetector Data API.

---

## 2. Processus

| Composant | Cadence | Rôle |
|-----------|---------|------|
| `WeatherStrategyRunner` | `weatherAlgoPollMs` (défaut 30 min) | Sorties puis entrées city-follow |
| `WeatherExitEvaluator` | début de chaque cycle | Drift + bucket-exit (hysteresis) + pre-close |
| `WeatherAutoTrackJanitor` | `pollMs` | Cleanup legacy (no-op après suppression de `WeatherMarketSelection`) |
| `runWeatherEntryPipeline` | sur signal | Gate throttle re-entry + enqueue `WEATHER_OPEN` |
| Heartbeat / runtime-status | 30 s | Redis `weather-algo:heartbeat`, `weather-algo:runtime-status` |

Les sorties tournent **même si `weatherAlgoEnabled = false`** (positions ouvertes).

---

## 3. Stratégie & sorties

**Entrée** : pour chaque ville surveillée (métrique v1 = `highest_temp`), la
stratégie active choisit son bucket via `evaluateGroup` :
- **`weather-forecast`** (défaut live) : `pickBestEdgeBucket` — palier à plus
  grand edge YES parmi les buckets actifs ;
- **`weather-forecast-aligned`** : `selectForecastAlignedBucket` — palier dont
  la fourchette contient le forecast mean.

Puis **BUY YES uniquement** si l'edge dépasse le seuil dynamique. Plusieurs
stratégies peuvent être activées (ordre catalogue = priorité first-wins). Modes
`single` / `multi` entre **villes** (`spread` ignoré → traité comme `single`).

**UI** : onglet **Stratégies** (checkboxes d'activation ; priorité first-wins =
ordre du catalogue, pas l'ordre de cochage). Params JSON
`weatherAlgoStrategies` / `weatherAlgoStrategyParams` — catalogue partagé dans
`@polywatch/core` (`strategy-catalog.ts`). Les seuils d'entrée (minEdge, minProb,
maxStd) restent des knobs globaux (onglet Paramètres).

**Sorties** :
- `WEATHER_PRE_CLOSE` (pré-clôture) si `hoursToEnd <= weatherAlgoCloseBeforeResolutionHours` (prioritaire)
- `WEATHER_FORECAST_CHANGE` si `|currentMean - entryMean| > weatherAlgoForecastChangeThreshold`
- `WEATHER_BUCKET_EXIT` si forecast hors palier **et** `weatherAlgoCityFollowSwitchMode = close_and_reenter` **après** `weatherAlgoBucketHysteresisPolls` polls consécutifs ; en mode `hold`, pas de close pour bucket leave
- Après close bucket/drift : throttle Redis `weather-reentry:{city}:{mode}` pendant `weatherAlgoReentryThrottleMs`

Le réglage UI s'appelle **Pré-clôture (heures avant fin)** — même concept que la pré-clôture crypto/copy (fenêtre avant résolution), en heures plutôt qu'en secondes.

---

## 4. Capacités

| Capacité | État |
|----------|------|
| Sélection par ville | Actif |
| BUY YES sur bucket forecast | Actif |
| 1 position max par ville (`pending`/`open`/`closing`) | Actif |
| Sorties avant entrées (même cycle) | Actif |
| Close drift forecast | Actif |
| Auto-close / pré-clôture avant résolution | Actif |
| Bucket-exit `close_and_reenter` / `hold` | Actif |
| Hysteresis Redis `weather-bucket-hysteresis:{positionId}` | Actif |
| Re-entry throttle `weather-reentry:{city}:{mode}` | Actif |
| Métrique forcée `highest_temp` | Actif |
| Expand / follow par `conditionId` | Retiré |
| `add_position` | Hors scope (coercé → `close_and_reenter`) |
| Persistance snapshots / ticks / eval / forecast history | Actif (toggles ON par défaut) |
| Onglet UI Données (cards, drill-down, purge) | Actif |
| Onglet UI **Backtest** (lancer runs, métriques, equity, positions) | Actif (domaine weather) |
| Onglet UI **Stratégies** (catalogue, activation, params) | Actif |
| Onglet UI **Villes → Données télécharger** (ingestion historique CLOB) | Actif |

---

## 5. Persistance données (backtest / audit)

Enregistrement **best-effort** pendant les cycles du runner (toggles ON par défaut) :

| Table | Contenu |
|-------|---------|
| `weather_forecast_history` | Révisions forecast (fetch réel uniquement) |
| `weather_market_snapshots` + `weather_bucket_ticks` | Contexte marché + prix YES/NO buckets actifs |
| `weather_evaluation_log` | Décisions signal/abstain |

Purge horaire selon rétention (`weatherAlgo*RetentionDays`), indépendante des toggles.

**UI** : page Weather Algo → onglet **Données** (cards, cadence, drill-down, purge) ; toggles dans **Paramètres**.

Doc d’implémentation : [`plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md`](./plans/applied/2026-08-08_IMPL-weather-market-data-persistence.md).

### Ingestion historique CLOB (onglet Villes → Données télécharger)

Depuis l'onglet **Villes**, la section **Données télécharger** permet de charger en base l'historique des prix YES/NO des buckets météo d'une ville sur une période, via l'API CLOB Polymarket `/prices-history` (`startTs`/`endTs` + `fidelity`). Service : `WeatherHistoryIngestService` ; routes `/api/weather-algo-history/*` ; tables `weather_clob_price_history` + `weather_history_ingest_jobs`.

- **Découverte** : buckets de la ville sur la période via Gamma (`tag_slug=weather`, `closed`/`open`, `end_date_min/max`).
- **Fetch** : pour chaque bucket, YES et NO, `fetchPriceHistory({ assetId, startTs, endTs, fidelity })` (throttlé).
- **Persistance** : upsert idempotent (index unique `condition_id, side, recorded_at, fidelity_minutes`) — relancer ne crée pas de doublons ; plusieurs intervalles (15 min, 1 h, …) peuvent coexister pour la même ville/date. Suppression ciblée par intervalle via `deleteCityInterval(city, fidelityMinutes)`.
- **Contraintes CLOB** : `startTs` + `endTs` obligatoires (sans `startTs` → HTTP 400). `startDate` dérivé du champ Gamma `startDate` (l'API ne renvoie plus `eventStartTime`) ; en dernier recours, fenêtre de 7 jours avant `endTs`. Granularité `fidelity` en minutes (testé jusqu'à 1 min). L'historique des marchés météo quotidiens (depuis ~mars 2026) reste disponible.
- **Limites** : série de prix `(t, p)` uniquement — pas d'order book, pas de volume/trades, pas d'OHLCV natif. Fenêtre de vie d'un bucket météo = quelques jours.
- **Point de settlement synthétique** : `/prices-history` ne renvoie **jamais** le payoff post-résolution (1.00 gagnant / 0.00 perdant, fixé par l'oracle). Pour un marché **résolu**, le service ajoute un point final synthétique à la série afin que le bucket gagnant atteigne 1.00. Le gagnant est détecté via `outcomePrices` (fast path, gate `closed`/`acceptingOrders`) ou via `fetchGammaMarket` (slow path, gate `gamma.resolved`). Le point est horodaté **après** le dernier trade de la série (jamais avant), pour rester le dernier point de la courbe.
- **Marge de résolution** : la fenêtre de fetch est étendue de `48 h` au-delà de `endDate` (`RESOLUTION_MARGIN_SEC`), car les marchés météo ne se règlent qu'après publication du résultat officiel — sans cette marge, le point de résolution serait coupé.
- **Affichage timeline** : les vues timeline (`getClobPriceHistoryTimeline` / `getBucketTicksTimeline`) récupèrent les `maxTicks` points **les plus récents** (tri DESC) puis les re-trient chronologiquement, pour ne jamais tronquer la queue de résolution.

Doc API : [`api.md`](./api.md) § Weather Algo history. Modèle : [`modele-donnees.md`](./modele-donnees.md).

Le **backtest** supporte deux modes d'exécution (`backtestExecutionMode`) :
- **`strategy`** : ré-évalue bucket par bucket (rapide, non équivalent live) ;
- **`runner-sim`** : regroupe les buckets par ville/date, `evaluateGroup`, dedup
  et selectionMode comme le runner live.

Voir [`backtest.md`](./backtest.md) (`engineVersion` ≥ `0.2.0` …).

---

## 6. API & config

- Routes trading : [`api.md`](./api.md) § Weather Algo
- Routes données : [`api.md`](./api.md) § Weather Algo data (`/api/weather-algo-data/*`) et § Weather Algo history (`/api/weather-algo-history/*`)
- Routes backtest : [`api.md`](./api.md) § Backtest (`/api/backtest/*`) ; moteur : [`backtest.md`](./backtest.md)
- Config : [`configuration.md`](./configuration.md) § Weather Algo ; entité `WeatherConfig` ; présentation API `packages/core/src/risk/weather-config-api.ts`
- Sorties / defaults intervalle : `packages/core/src/risk/weather-exit-params.ts` (`resolveWeatherEntryExitParams`)
- Redis : `weather-reentry-throttle.ts`, `weather-bucket-hysteresis.ts`
- Entités : [`modele-donnees.md`](./modele-donnees.md)
- Backtest : [`backtest.md`](./backtest.md)
- Détail technique package : [`code/08-weather-algo.md`](./code/08-weather-algo.md)

Démarrage : `npm run dev:weather-algo` ou `npm run dev`.
