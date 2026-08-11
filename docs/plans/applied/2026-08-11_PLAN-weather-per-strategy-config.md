# Plan — Configuration per-strategy weather algo

**Date** : 2026-08-11  
**Statut** : **applied** (2026-08-11)  
**Doc produit** : [`../../weather-algo.md`](../../weather-algo.md) · [`../../code/08-weather-algo.md`](../../code/08-weather-algo.md) · [`../../configuration.md`](../../configuration.md)  
**Objectif** : Remplacer les ~40 tunables `weatherAlgo*` globaux par une
configuration **par stratégie** — chaque stratégie activée porte sa config
complète (gates d'entrée, sizing, sorties, SL/TP/trailing, risk limits,
kill-switch, pre-close). Les globaux structurels (polling, sélection,
recording, capital sim) restent partagés.

---

## 1. Décisions de design

| Q | Choix | Détail |
|---|---|---|
| Périmètre per-strategy | **Tout** sauf globaux structurels | Gates d'entrée, sizing, sorties drift/bucket, SL/TP/trailing, risk limits, kill-switch, pre-close |
| Globaux restants | `weatherAlgoEnabled` / `Sim` / `Real` / `selectionMode` / `maxSignalsPerEvent` / `pollMs` / `strategies` / recording toggles / retentionDays / `simInitialCapitalWeather` | Toggles activation, polling, sélection, recording/retention |
| Typage | **Fort** dérivé du catalogue | `WeatherStrategyParamsBag` (pas `Record<string, any>`) ; `StrategyParamSchema` déclaratif |
| Rétrocompatibilité | **Fallback catalogue defaults** | Bag = `{ ...DEFAULT_WEATHER_STRATEGY_PARAMS, ...stored }` ; `strategyId` nullable sur legacy |
| Colonnes legacy | **Gardées comme source backfill** | Migrations `0107`/`0108` copient les valeurs globales dans chaque bag de stratégie activée ; plus lues au runtime |
| Absence de clé | `DEFAULT_WEATHER_STRATEGY_PARAMS` | Override partiel autorisé ; clés absentes → défaut catalogue |
| `0` vs `null` | **Coercition `0 → null`** pour nullables | `NULLABLE_ZERO_KEYS` = `maxForecastStd`, `minForecastProbability`, `*BidPoints` |

---

## 2. Schéma de données

### 2.1 `WeatherConfig.weatherAlgoStrategyParams`

Colonne JSON `text` (sérialisée `JSON.stringify`). Structure :

```typescript
type WeatherStrategyParamsMap = Record<string, Partial<WeatherStrategyParamsBag>>;
// ex: { "weather-forecast": { minEdge: 0.12, maxDailyLossUsdc: 50 }, "weather-forecast-aligned": { minEdge: 0.08 } }
```

Résolution runtime : `getStrategyParams(cfg, strategyId)` →
`{ ...DEFAULT_WEATHER_STRATEGY_PARAMS, ...stored }` + coercition `0 → null`
pour les nullables.

### 2.2 `strategy_id` sur positions et snapshots

- `copied_positions.strategy_id` (`varchar NULL`, index
  `IDX_copied_positions_strategy_id`) — migration
  `AddWeatherStrategyId1700000000106`.
- `weather_position_forecasts.strategy_id` (`varchar NULL`) — idem.
- Backfill legacy : `BackfillWeatherStrategyRepair1700000000108` set
  `strategy_id = 'weather-forecast'` pour `reason LIKE 'WEATHER_%'` et
  snapshots orphelins.

### 2.3 Migrations

| Migration | Rôle |
|-----------|------|
| `AddWeatherStrategyId1700000000106` | Ajoute `strategy_id` (nullable + index) sur `copied_positions` et `weather_position_forecasts` |
| `BackfillWeatherStrategyParams1700000000107` | Backfill `weather_algo_strategy_params` depuis colonnes legacy (merge clé-à-clé avec overrides existants) |
| `BackfillWeatherStrategyRepair1700000000108` | Repair installs ayant déjà run `0107` avec l'ancienne logique + backfill `strategy_id` legacy |

> `0107` et `0108` partagent la même logique SQL de merge clé-à-clé
> (`jsonb_build_object(...) || COALESCE(existing, '{}'::jsonb)`).

---

## 3. Surface de code modifiée

### 3.1 Core (`@polywatch/core`)

| Fichier | Changement |
|---------|------------|
| `weather/strategy-catalog.ts` | `DEFAULT_WEATHER_STRATEGY_PARAMS`, `WeatherStrategyParamsBag`, `getStrategyParams` (+ coercition `0→null`), `sanitizeWeatherStrategyParams` (clés `DEFAULT_*`) |
| `risk/policy.ts` | `getWeatherMaxOpenPositions` / `maxPositionSizeUsdc` / `maxExposureUsdc` / `maxDailyLossUsdc` / `killSwitchAction` / `slConfirmationTicks` / `slCloseMaxRetries` / `preCloseParams` acceptent `strategyId` + résolvent via `weatherBag` |
| `risk/weather-exit-params.ts` | `resolveWeatherEntryExitParams(risk, mode, interval, strategyId)` |
| `risk/crypto-algo-helpers.ts` | `getPositionPreCloseParams(..., strategyId)` pour weather |
| `risk/sim-rotation-targets.ts` | `weatherAlgoStrategyParams` ajouté aux rotation keys (reset sim au change) |
| `services/risk.service.ts` | `checkKillSwitch('weather', mode, strategyId?)` filtre PnL par `p.strategy_id` |
| `services/reservation.service.ts` | `ReserveInput.strategyId` persisté ; `countActivePositions` / `computeExposure` filtrent par `strategyId` pour weather |
| `services/weather-position-forecast.service.ts` | `saveIfAbsent` persiste `strategyId` |
| `services/market-resolution.service.ts` | `loadPreCloseSource` agrège pre-close weather via `resolveWeatherPreCloseAggregate` |
| `entities/CopiedPosition.ts` | Colonne `strategyId` + index |
| `entities/WeatherPositionForecast.ts` | Colonne `strategyId` |
| `index.ts` | Export `DEFAULT_WEATHER_STRATEGY_PARAMS`, `WeatherStrategyParamsBag`, `getWeatherSlConfirmationTicks`, `getWeatherSlCloseMaxRetries` |

### 3.2 Weather-algo (`@polywatch/weather-algo`)

| Fichier | Changement |
|---------|------------|
| `strategy/strategy.ts` | `WeatherStrategy.setRiskConfig(bag: WeatherStrategyParamsBag)` |
| `strategy/weather-forecast.strategy.ts` | Lit `params.minEdge` / `maxForecastStd` / `minForecastProbability` du bag |
| `strategy/weather-forecast-aligned.strategy.ts` | Idem |
| `strategy/strategy-runner.ts` | `setRiskConfig` résout bag par stratégie via `getStrategyParams` |
| `processors/weather-entry-pipeline.ts` | Kill-switch gate (`checkKillSwitch('weather', mode, signal.strategyId)`) ; sizing/depth retry depuis `bag` ; `strategyId` persisté |
| `processors/weather-exit-evaluator.ts` | `bag = getStrategyParams(risk, snapshot.strategyId ?? pos.strategyId ?? enabled[0] ?? 'weather-forecast')` ; toutes les sorties lisent `bag.*` |

### 3.3 Worker

| Fichier | Changement |
|---------|------------|
| `processors/strategy-processing.ts` | `refreshMarketsNearEnd` utilise `resolveWeatherPreCloseAggregate` |
| `processors/strategy/kill-switch-monitor.ts` | Itère stratégies activées ; `maxDailyLossUsdc` / `killSwitchAction` per-strategy ; ferme uniquement positions de la stratégie |
| `processors/strategy/position-branches.ts` | `getPositionPreCloseParams(pos.strategyId)` |
| `processors/strategy/position-exit-evaluator.ts` | `getWeatherSlCloseMaxRetries(cfg, mode, pos.strategyId)` / `getWeatherSlConfirmationTicks(cfg, pos.strategyId)` |

### 3.4 Backend

| Fichier | Changement |
|---------|------------|
| `routes/config-per-kind.ts` | `weatherStrategyParamsBagSchema` + `weatherStrategyParamsMapSchema` (zod) ; `weatherConfigUpdateSchema` per-strategy + `.strict()` (rejette legacy) |
| `routes/config.ts` | Strip legacy per-strategy de `configSchema` |

### 3.5 Frontend

| Fichier | Changement |
|---------|------------|
| `components/WeatherAlgoStrategiesTab.tsx` | Rendu params per-strategy (`ToggleField` / `NumberField` / `NullableNumberField` / `SelectField`) ; `updateStrategyParam(value: number \| boolean \| string \| null)` |
| `components/WeatherAlgoSettingsTab.tsx` | Globaux structurels uniquement |
| `components/settings-fields.tsx` | `SelectField` + `NullableNumberField` |
| `api.ts` | `WeatherStrategyMeta.params[].options` pour `select` ; `weatherAlgoStrategyParams: Record<string, Record<string, number \| boolean \| string \| null>>` |

### 3.6 Backtest

| Fichier | Changement |
|---------|------------|
| `adapters/weather/weather-adapter.ts` | `strategyId` propriété ; `runBag(ctx)` résout bag ; `setRiskConfig(stratégies, bag)` ; `resolvedExitMeta(strategyId)` |
| `engine/exit-manager.ts` | `WeatherExitManager(strategyId)` ; `this.bag` ; toutes lectures `risk.weatherAlgo*` → `this.bag.*` |

### 3.7 E2E

| Fichier | Changement |
|---------|------------|
| `e2e/weather-algo/helpers/risk-config.ts` | `configureWeatherAlgoRisk` set `weatherAlgoStrategies` + `weatherAlgoStrategyParams` |

---

## 4. Kill-switch per-strategy

- **Évaluation** : `RiskService.checkKillSwitch('weather', mode, strategyId)` —
  PnL journalière filtrée par `p.strategyId = :strategyId`.
- **Gate entry** : `weather-entry-pipeline.runMode` appelle `checkKillSwitch`
  avant reserve ; `blockEntries` → skip `'Kill-switch actif (block_entries)'`.
- **`force_close_all`** : `KillSwitchMonitor` (worker) ferme uniquement les
  positions de la stratégie concernée (`getDailyNetForAlgo(strategyId)` /
  `forceCloseAllPositions(strategyId)`).
- **Limites** : `bag.maxDailyLossUsdc` / `bag.killSwitchAction` par stratégie.

## 5. Réservation per-strategy

`ReservationService` :
- `ReserveInput.strategyId` persisté sur `CopiedPosition`.
- `countActivePositions` / `computeExposure` filtrent par `strategyId` pour
  weather (limite `bag.maxOpenPositions` / `bag.maxExposureUsdc` par stratégie,
  pas globale).
- `computeExposure` infère `strategyId` via la position liée quand la
  réservation n'a pas `strategyId` persisté.

## 6. Pre-close per-strategy

- `bag.preCloseEnabled` / `bag.preCloseSeconds` / `bag.closeBeforeResolutionHours`.
- **Agrégation cross-stratégies** : `resolveWeatherPreCloseAggregate(risk)`
  retourne `{ enabled, seconds }` = OR des bags activés (si une stratégie a
  pre-close activé, le rafraîchissement marché near-end l'applique).
- `market-resolution.service.loadPreCloseSource` et
  `strategy-processing.refreshMarketsNearEnd` utilisent l'agrégat.

## 7. UI

- **Onglet Paramètres** : globaux structurels (toggles, `pollMs`,
  `selectionMode`, `maxSignalsPerEvent`, recording/retention,
  `simInitialCapital`).
- **Onglet Stratégies** : checkboxes activation + section params par stratégie.
  Champs rendus selon `StrategyParamSchema.kind` :
  - `boolean` → `ToggleField`
  - `select` → `SelectField` (options du catalogue)
  - `number` nullable (`NULLABLE_PARAM_KEYS`) → `NullableNumberField` (vide/`0` = `null`)
  - `number` non-nullable → `NumberField`
- Hint : « Chaque stratégie porte sa propre config. »

## 8. API

`PUT /api/config/weather` :
```json
{
  "weatherAlgoEnabled": true,
  "weatherAlgoStrategies": ["weather-forecast", "weather-forecast-aligned"],
  "weatherAlgoStrategyParams": {
    "weather-forecast": { "minEdge": 0.12, "maxDailyLossUsdc": 50 },
    "weather-forecast-aligned": { "minEdge": 0.08 }
  }
}
```

`weatherConfigUpdateSchema` (zod, `.strict()`) : accepte uniquement les
globaux structurels + `weatherAlgoStrategyParams` (map per-strategy). Rejette
les champs legacy (`weatherAlgoMinEdge`, etc.).

`GET /api/weather-algo/strategy-catalog` : catalogue + `params` déclaratifs
(`StrategyParamSchema[]` avec `key`, `kind`, `label`, `options?`).

## 9. Checklist prod

1. `npm run migrate` (applique `0106` + `0107` + `0108`).
2. Spot-check SQL : `SELECT weather_algo_strategies, weather_algo_strategy_params FROM weather_config;` — chaque stratégie activée doit avoir un bag.
3. Spot-check : `SELECT strategy_id, COUNT(*) FROM copied_positions WHERE reason LIKE 'WEATHER_%' GROUP BY strategy_id;` — legacy → `'weather-forecast'`.
4. Smoke UI : onglet Stratégies affiche les sections params ; sauvegarde d'un
   paramètre met à jour `weatherAlgoStrategyParams`.
5. Test : `npm run test -w @polywatch/weather-algo` + `@polywatch/core` + `@polywatch/backtest`.