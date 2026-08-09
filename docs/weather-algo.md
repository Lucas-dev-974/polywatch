# Package `@polywatch/weather-algo` — Trading algorithmique météo

Module d'automatisation pour les marchés **température** Polymarket : sélection
par **ville**, prévisions Open-Meteo multi-modèles, BUY YES sur le palier aligné
au forecast, sorties drift / bucket / pre-close.

---

## 1. Vue d'ensemble

```
Villes surveillées (WeatherAutoTrackRule)
        │
        ▼
StrategyRunner (poll weatherAlgoPollMs)
        │  1. ExitEvaluator (sorties d'abord)
        │  2. discoverWeatherMarkets + forecast
        │  3. selectForecastAlignedBucket → BUY YES si edge OK
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

**Entrée** : pour chaque ville surveillée (métrique v1 = `highest_temp`), sélection
du bucket aligné (`selectForecastAlignedBucket`), puis **BUY YES uniquement** si
l'edge YES dépasse le seuil dynamique. Modes `single` / `multi` entre **villes**
(`spread` ignoré → traité comme `single`).

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

Le **backtest** de la stratégie (rejouer les données persistées ci-dessus) est
décrit dans [`backtest.md`](./backtest.md).

---

## 6. API & config

- Routes trading : [`api.md`](./api.md) § Weather Algo
- Routes données : [`api.md`](./api.md) § Weather Algo data (`/api/weather-algo-data/*`)
- Routes backtest : [`api.md`](./api.md) § Backtest (`/api/backtest/*`) ; moteur : [`backtest.md`](./backtest.md)
- Config : [`configuration.md`](./configuration.md) § Weather Algo ; entité `WeatherConfig` ; présentation API `packages/core/src/risk/weather-config-api.ts`
- Sorties / defaults intervalle : `packages/core/src/risk/weather-exit-params.ts` (`resolveWeatherEntryExitParams`)
- Redis : `weather-reentry-throttle.ts`, `weather-bucket-hysteresis.ts`
- Entités : [`modele-donnees.md`](./modele-donnees.md)
- Backtest : [`backtest.md`](./backtest.md)
- Détail technique package : [`code/08-weather-algo.md`](./code/08-weather-algo.md)

Démarrage : `npm run dev:weather-algo` ou `npm run dev`.
