# Implémentation — Persistance données marché weather + onglet Données

**Date** : 2026-08-08  
**Statut** : **Appliqué** (Phases 0–4 du plan + UI onglet Données / purge)  
**Plan source** : [`../2026-08-08_PLAN-weather-market-data-persistence.md`](../2026-08-08_PLAN-weather-market-data-persistence.md)  
**Hors scope initial** : Phase 5 (`WeatherDataLoader` / `packages/backtest`) — **implémentée depuis 2026-08-09** ; voir [`../backtest.md`](../backtest.md) et [`../2026-08-05_PLAN-backtest-engine-universel.md`](../2026-08-05_PLAN-backtest-engine-universel.md)

---

## 1. Objectif livré

À chaque cycle du `WeatherStrategyRunner` (`weatherAlgoPollMs`, défaut 30 min), pour chaque ville suivie × date look-ahead :

1. Persister un **snapshot marché** + **bucket ticks** (prix YES/NO des buckets actifs)
2. Persister un **forecast history** si fetch Open-Meteo réel (pas cache hit / pas stale)
3. Persister un **evaluation log** (signal / abstain + edge / seuil) par bucket × stratégie

Exposition UI : onglet **Données** (cards + drill-down + purge) ; toggles / rétention dans **Paramètres**.

---

## 2. Tables & écriture

| Table | Process auteur | Cadence | Toggle |
|---|---|---|---|
| `weather_forecast_history` | weather-algo | Fetch Open-Meteo réel (≤ 1× / poll) | `weatherAlgoForecastHistoryRecordingEnabled` (défaut **true**) |
| `weather_market_snapshots` | weather-algo | 1× / poll / ville × date | `weatherAlgoMarketSnapshotRecordingEnabled` |
| `weather_bucket_ticks` | weather-algo | avec chaque snapshot (CASCADE delete) | (même toggle snapshots) |
| `weather_evaluation_log` | weather-algo | 1× / poll / bucket × stratégie | `weatherAlgoEvaluationLogRecordingEnabled` |
| `weather_forecast_cache` | weather-algo / core | upsert opérationnel (déjà existant) | — |
| `weather_position_forecasts` | entry pipeline | à l’ouverture de position (déjà existant) | — |

**Purge** : timer horaire dans `packages/weather-algo/src/index.ts`, **indépendant** des toggles d’écriture ; rétention via `weatherAlgo*RetentionDays`.

**Migration** : `AddWeatherMarketDataPersistence1700000000100`.

---

## 3. Fichiers clés

| Couche | Fichiers |
|---|---|
| Entités | `WeatherForecastHistory`, `WeatherMarketSnapshot`, `WeatherBucketTick`, `WeatherEvaluationLog` + colonnes recording sur `WeatherConfig` |
| Recorders | `weather-forecast-history-recorder.ts`, `weather-market-snapshot-recorder.ts`, `weather-evaluation-recorder.ts` |
| Lecture / purge API | `weather-algo-data.service.ts` |
| Runner | `strategy-runner.ts`, `runner-bucket-helpers.ts`, `weather-forecast.strategy.ts` |
| Bootstrap | `packages/weather-algo/src/index.ts` |
| Routes | `packages/backend/src/routes/weather-algo-data.ts` (mount `/api/weather-algo-data`) |
| UI | `WeatherAlgoDataTab.tsx`, `WeatherAlgoSettingsTab.tsx`, `WeatherAlgoPage.tsx` |

---

## 4. API (`/api/weather-algo-data`, JWT)

| Méthode | Path | Rôle |
|---|---|---|
| `GET` | `/tables` | Résumé 6 tables : `rowCount`, `oldestAt`, `newestAt`, `tableName` |
| `DELETE` | `/tables` | Vide les 6 tables (ordre FK-safe) → `{ deleted, totalDeleted }` |
| `GET` | `/forecast-history` | Liste paginée |
| `GET` | `/market-snapshots` | Liste ; query `includeTicks` (**défaut `false`**) |
| `GET` | `/bucket-ticks` | Liste (+ `cityNormalized` via JOIN snapshot) |
| `GET` | `/evaluation-log` | Liste |
| `GET` | `/forecast-cache` | Liste |
| `GET` | `/position-forecasts` | Liste (+ `openedAt` via JOIN `copied_positions`) |
| `GET` | `/coverage` | Agrégat legacy (snapshots) — plus consommé par l’UI |

---

## 5. UI

### Onglet **Données** (`WeatherAlgoDataTab`)

- Grille de **6 cards** : titre, nom SQL, description, **cadence** (dérivée de `weatherAlgoPollMs` pour les tables cycliques), compteur lignes, plus ancienne / plus récente
- Clic → vue détail paginée (50) + filtres par table
- **Tout supprimer** avec `confirm` native, puis refresh du résumé

### Onglet **Paramètres**

- Section « Enregistrement données backtest » : 3 toggles + 3 rétentions
- Le mini-panneau `WeatherAlgoDataCoveragePanel` a été **retiré** (remplacé par l’onglet Données)

---

## 6. Écarts vs plan v4 d’origine

| Point plan v4 | Réalité livrée |
|---|---|
| Mini panneau couverture dans Paramètres | Remplacé par onglet **Données** |
| API lecture seule (4 routes) | + `/tables`, `DELETE /tables`, `/bucket-ticks`, `/forecast-cache`, `/position-forecasts` ; `includeTicks` sur snapshots |
| Pas d’UI pour les listes | Drill-down frontend sur les 6 tables |
| Phase 5 backtest | **Implémentée** (2026-08-09) — [`../backtest.md`](../backtest.md) |

---

## 7. Doc liée

- Produit : [`../../weather-algo.md`](../../weather-algo.md) § Persistance
- Code package : [`../../code/08-weather-algo.md`](../../code/08-weather-algo.md)
- API : [`../../api.md`](../../api.md) § Weather Algo data
- Modèle : [`../../modele-donnees.md`](../../modele-donnees.md)
- Config : [`../../configuration.md`](../../configuration.md)
- Frontend : [`../../frontend.md`](../../frontend.md)
