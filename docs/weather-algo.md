# Package `@polywatch/weather-algo` — Trading algorithmique météo

Module d'automatisation pour les marchés **température** Polymarket : prévisions
Open-Meteo multi-modèles, calcul d'edge vs prix marché, signaux d'entrée
`WEATHER_OPEN` et sorties `WEATHER_FORECAST_CHANGE` / `WEATHER_PRE_CLOSE`.

---

## 1. Vue d'ensemble

```
Sélections (DB / UI / auto-track)
        │
        ▼
StrategyRunner (poll WEATHER_ALGO_POLL_MS / weatherAlgoPollMs)
        │  discoverWeatherMarkets + fetchWeatherForecast (cache DB)
        ▼
WeatherForecastStrategy → runWeatherEntryPipeline → weather-order-signals
        │
        ▼
WeatherExitEvaluator → close-signals (drift / pre-close)
        │
        ▼
worker Executor
```

Positions rattachées à une watchlist sentinelle weather-algo. Snapshot forecast
d'entrée dans `WeatherPositionForecast`.

---

## 2. Processus

| Composant | Cadence | Rôle |
|-----------|---------|------|
| `WeatherStrategyRunner` | `weatherAlgoPollMs` (défaut 30 min) | Entrées (expand + city-follow) + déclenche l'évaluateur de sorties |
| `WeatherExitEvaluator` | fin de chaque cycle runner | Drift forecast + bucket-exit (city-follow) + auto-close avant résolution |
| `WeatherAutoTrackJanitor` | `pollMs` | Règles expand → `WeatherMarketSelection` ; règles city-follow ignorées (sélection à runtime) |
| `runWeatherEntryPipeline` | sur signal | Enqueue `WEATHER_OPEN` + snapshot forecast |
| Heartbeat / runtime-status | 30 s | Redis `weather-algo:heartbeat`, `weather-algo:runtime-status` |

Les sorties tournent **même si `weatherAlgoEnabled = false`** (positions ouvertes).

---

## 3. Stratégie & sorties

**Entrée (expand)** : edge forecast vs marché, modes `single` / `multi` / `spread`.

**Entrée (city-follow)** : l'utilisateur suit une ville (ex. Paris) au lieu de sous-marchés individuels. Le système sélectionne automatiquement le bucket (sous-marché) dont le palier contient la température prédite par Open-Meteo (`selectForecastAlignedBucket`), puis évalue l'edge sur ce seul bucket. Le comportement en cas de changement de bucket est configurable via `weatherAlgoCityFollowSwitchMode`.

**Sorties** :
- `WEATHER_FORECAST_CHANGE` si `|currentMean - entryMean| > weatherAlgoForecastChangeThreshold`, ou si le forecast sort du palier d'entrée (mode `close_and_reenter`)
- `WEATHER_PRE_CLOSE` si `hoursToEnd <= weatherAlgoCloseBeforeResolutionHours` (prioritaire si les deux)
- Close via `close-signals` sans `beginClose` préalable (le worker le fait à la consommation)

---

## 4. Capacités

| Capacité | État |
|----------|------|
| Entrée `WEATHER_OPEN` | Actif |
| Snapshot `WeatherPositionForecast` à l'enqueue | Actif |
| Close drift forecast | Actif |
| Auto-close avant résolution | Actif |
| Gate entrée close-before | Actif |
| Auto-track sync (expand) | Actif |
| City-follow (auto-sélection du bucket) | Actif |
| Bucket-exit (close_and_reenter / hold / add_position) | Actif |
| Re-entry throttle dédié | Non câblé |

---

## 5. API & config

- Routes : [`api.md`](./api.md) § Weather Algo
- RiskConfig : [`configuration.md`](./configuration.md) § Weather Algo
- Entités : [`modele-donnees.md`](./modele-donnees.md)

Démarrage : `npm run dev:weather-algo` ou `npm run dev`.
