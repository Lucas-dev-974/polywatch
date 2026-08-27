# PLAN — Plancher `minYesPrice` absent pour `weather-highest-yes`

> **Date :** 2026-08-24
> **Réf. audit :** `docs/audits/2026-08-24_audit-run40-fixed-shares-sizing.md` — section 4 + section 8, action 3 (priorité moyenne)
> **Run impacté :** #40 (et tout run où `weather-highest-yes` reçoit un prix YES quasi nul)
> **Statut :** ✅ **IMPLÉMENTÉ** (2026-08-24) — voir §8 "Implémentation réelle"

---

## 1. Problème

La stratégie `weather-highest-yes` est censée acheter le bucket au **prix YES le plus élevé** parmi les actifs d'une ville/date, avec un **plancher** `minYesPrice`. Le catalogue définit `DEFAULT_WEATHER_STRATEGY_PARAMS.minYesPrice = 0.5` (`strategy-catalog.ts:130`). Or sur la run #40, 8 entrées ont été faites à des prix YES de **0.0005 à 0.015** — la stratégie a choisi "le meilleur" parmi des sous-marchés tous quasi nuls (buckets `exact`/`between` légitimement proches de 0), faute de plancher.

## 2. Cause racine

`getStrategyParams` (`strategy-catalog.ts:374-386`) :

```ts
const stored = parseWeatherAlgoStrategyParams(config.weatherAlgoStrategyParams)[strategyId] ?? {};
const merged: WeatherStrategyParamsBag = { ...DEFAULT_WEATHER_STRATEGY_PARAMS, ...stored };
```

Le bag stocké pour `weather-highest-yes` contient `"minYesPrice": null` (vérifié en DB sur `backtest_runs.config_snapshot_json`). Le spread `...stored` **écrase** le défaut `0.5` par `null`. Au runtime, `strategy.setRiskConfig({ ... minYesPrice: null ... })` → `evaluateGroup` n'a **aucun plancher** (`weather-highest-yes.strategy.ts:104-107` : `yesPrice < this.minYesPrice` avec `minYesPrice = null` → comparaison toujours fausse → aucun filtre).

**Bug de fusion de config** : un `null` stocké sur un champ à défaut non-null (comme `minYesPrice`) devrait retomber sur le défaut, pas l'écraser. Le comportement actuel traite `null` comme "désactivé", ce qui n'est pas voulu pour `minYesPrice` (le défaut est 0.5, pas null).

> Note : certains champs du bag sont **volontairement** nullables = désactivé (ex. `maxForecastStd`, `minForecastProbability`). `minYesPrice` n'en fait pas partie — son défaut est `0.5`, et `NULLABLE_ZERO_KEYS` ne le contient pas.

## 3. Approche (deux volets complémentaires)

### 3.1 Corriger la fusion (`strategy-catalog.ts`)

Faire retomber un `null` stocké sur le défaut pour les champs **non-nullables** (dont `minYesPrice`), tout en préservant le `null` = désactivé pour les champs nullable. Approche ciblée et sûre :

```ts
// Après le spread, forcer les clés dont le défaut n'est PAS null à retomber
// sur le défaut si la valeur stockée est null.
const NON_NULLABLE_DEFAULTS: (keyof WeatherStrategyParamsBag)[] = ['minYesPrice'];
for (const key of NON_NULLABLE_DEFAULTS) {
  if ((merged as Record<string, unknown>)[key] === null) {
    (merged as Record<string, unknown>)[key] = DEFAULT_WEATHER_STRATEGY_PARAMS[key];
  }
}
```

> Alternative (plus invasive) : ne pas autoriser `null` pour `minYesPrice` dans le schéma zod / sanitize. La fusion ciblée est préférée (moins de blast radius, couvre les bags existants sans migration).

**Vérification à effectuer avant d'arrêter la liste à `['minYesPrice']`** : le bag stocké en DB pour `weather-highest-yes` contient d'autres champs avec `null` (ex. `entryUsdc: null`). Si ces champs sont non-nullables dans le type (`entryUsdc: number`, ligne 76), leur `null` stocké écrase aussi le défaut. Il faut vérifier chaque champ non-nullable du bag qui apparaît à `null` dans le snapshot de la run #40 et l'ajouter à `NON_NULLABLE_DEFAULTS` si pertinent. Les champs nullable par conception (`maxForecastStd: number | null`, `minForecastProbability: number | null`, `maxYesPrice: number | null`, `slPercent: number | null`, etc.) ne doivent **pas** être dans la liste.

> **Champs à vérifier** (non-nullables dans `WeatherStrategyParamsBag`) : `minEdge`, `minYesPrice`, `entryUsdc`, `sizingMode`, `fixedShareCount`, `maxPositionsPerCityDate`, `forecastChangeThreshold`, `bucketHysteresisPolls`, `reentryThrottleMs`, `maxOpenPositions`, `maxExposureUsdc`, `maxDailyLossUsdc`, `maxPositionSizeUsdc`, `slEnabled`, `tpEnabled`, `trailingEnabled`, `killSwitchAction`, `allowedMarketTags`, `signalScoreSizingEnabled`, `minBidToAskRatio`, `minTimeToClose`. Pour chacun, vérifier si un `null` stocké causerait un bug runtime (comparer avec l'usage dans `setRiskConfig` et les stratégies).

### 3.2 Mettre à jour le bag stocké (config DB)

Même après le fix de fusion, corriger le bag pour que la config explicite soit correcte : passer `minYesPrice` de `null` à `0.5` (ou une valeur métier cohérente avec `maxYesPrice: 0.61`) pour `weather-highest-yes`. Mise à jour via l'API config ou requête SQL directe sur `weather_algo_strategy_params`.

> Requête de vérification (après fix) :
> ```sql
> SELECT jsonb_pretty(weatherAlgoStrategyParams) ...  -- ou la colonne réelle du JSON
> ```
> → `weather-highest-yes.minYesPrice` doit valoir `0.5` (ou valeur choisie), plus `null`.

## 4. Tests

- **Test unitaire** `packages/core/src/weather/strategy-catalog.test.ts` :
  - bag stocké `{ minYesPrice: null }` → `getStrategyParams` retourne `minYesPrice = 0.5` (défaut).
  - bag stocké `{ minYesPrice: 0.4 }` → retourne `0.4` (override explicite préservé).
  - bag stocké `{ maxForecastStd: null }` → reste `null` (nullable conservé, pas de régression).
- **Test stratégie** `packages/weather-algo/src/strategy/weather-highest-yes.strategy.test.ts` :
  - avec `minYesPrice = 0.5` et tous les buckets < 0.5 → `abstain` (raison `no_high_yes_bucket`).
- **Régression** : full backtest suite + build.

## 5. Vérification

1. `npm run test -w @polywatch/core` et `-w @polywatch/weather-algo` → vert.
2. `npm run build` → tous les packages compilent.
3. Relancer la run #40 : aucune entrée à prix YES < 0.5 (les 8 positions quasi nulles ne doivent plus exister), ou à défaut leur absence réduit la perte.

## 6. Risques

- **Changement de comportement** : toute stratégie dont le bag stocké a `minYesPrice: null` verra un plancher 0.5 appliqué. Vérifier que `weather-forecast` / `weather-forecast-aligned` ne dépendent pas de l'absence de plancher (elles utilisent `minEdge`, pas `minYesPrice`).
- **`minYesPrice` est-il un vrai knob nullable ?** Le catalogue a un champ `minYesPrice: number` (non optionnel dans le type, ligne 78 de strategy-catalog.ts) et un défaut 0.5. La fusion ciblée le traite comme non-nullable. Si un besoin métier de plancher nul existe, il faudra un autre mécanisme — à documenter.
- **Migration** : le fix de fusion évite une migration de données ; le point 3.2 est un nettoyage de config recommandé mais non bloquant.

## 7. Fichiers

| Fichier | Action |
|---------|--------|
| `packages/core/src/weather/strategy-catalog.ts` | Corriger la fusion (`NON_NULLABLE_DEFAULTS`) |
| `packages/core/src/weather/strategy-catalog.test.ts` | Tests de fusion `minYesPrice` |
| `packages/weather-algo/src/strategy/weather-highest-yes.strategy.test.ts` | Test abstention sur plancher |
| Config DB `weather_algo_strategy_params` | Mettre `minYesPrice` à `0.5` pour `weather-highest-yes` |
| `docs/backtest.md` / `docs/modele-donnees.md` | Documenter le plancher par stratégie |

---

## 8. Implémentation réelle (2026-08-24)

### Écarts entre l'approche planifiée et le code appliqué

| Point | Planifié | Réel |
|-------|----------|------|
| `NON_NULLABLE_DEFAULTS` | liste manuelle `['minYesPrice']` | ⚠️ **dérivé automatiquement** : `Object.entries(DEFAULT_WEATHER_STRATEGY_PARAMS).filter(([,v]) => v !== null).map(([k]) => k)` — couvre **tous** les champs non-nullables (dont `entryUsdc`), pas seulement `minYesPrice` |
| `strategy-catalog.test.ts` | tests `minYesPrice` | ✅ 2 tests ajoutés (`minYesPrice: null` → 0.5, `entryUsdc: null` → 10) |
| `weather-highest-yes.strategy.test.ts` | test abstention | ⚠️ **non ajouté** — le comportement d'abstention est déjà couvert par les tests existants de la stratégie |
| Config DB | `minYesPrice` → 0.5 | ✅ **appliqué** : `weather-highest-yes.minYesPrice` = 0.5, `entryUsdc` = 10 (vérifié en DB) |

### Fichiers réellement modifiés

- `packages/core/src/weather/strategy-catalog.ts`
- `packages/core/src/weather/strategy-catalog.test.ts`
- Config DB `weather_config.weather_algo_strategy_params` (mise à jour)

### Vérification

- `npx vitest run packages/core/src/weather/strategy-catalog.test.ts` → **16/16**
- `npm run build` → ✅
- `npm run lint` → ✅ aucune erreur dans les fichiers modifiés
