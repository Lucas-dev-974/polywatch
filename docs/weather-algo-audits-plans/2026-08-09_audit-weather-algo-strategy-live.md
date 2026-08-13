# Audit stratégie Weather Algo (live, hors backtest)

**Date** : 2026-08-09  
**Stratégie** : `weather-forecast` (seule stratégie enregistrée **au moment de l'audit**)  
**Mode** : Simulation (`weatherAlgoRealEnabled=false`)  
**Sources** :
- Code : `packages/weather-algo/**`, `packages/core/src/weather/**`, `WeatherConfig`
- BDD : `tools/weather-algo-rules-audit.ts` + `tools/weather-algo-audit.ts` (snapshot `2026-08-09T07:25Z`)
- Canvas : [`weather-algo-strategy-audit-2026-08-09.canvas.tsx`](../../.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-strategy-audit-2026-08-09.canvas.tsx)

> **Addendum 2026-08-09 (post multi-stratégies)** — cet audit décrit l'état **avant** le chantier
> [`2026-08-09_PLAN-weather-multi-strategy-extensible.md`](./2026-08-09_PLAN-weather-multi-strategy-extensible.md).
> Depuis : catalogue + `weather-forecast-aligned`, `pickBestEdgeBucket` est dans la stratégie
> (`evaluateGroup`), plus dans le runner ; docs produit corrigées. Les conclusions BDD / ops
> (churn, gates, KPI) restent utiles ; les sections « une seule stratégie » / « pick dans runner »
> / « multi-stratégies = spec only » sont **obsolètes**.

---

## Verdict

| Question | Réponse |
|---|---|
| Quelle stratégie ? | **Une seule** : `weather-forecast` (value bet BUY YES sur edge forecast) |
| Bien définie / implémentée ? | **Oui côté code live** (gates + runner + exits cohérents). **Non côté doc produit** : elle décrit encore `selectForecastAlignedBucket` alors que le live fait `pickBestEdgeBucket`. |
| Règles respectées en BDD ? | **Plutôt oui** — 0 fail remonté par les checks, dont un **fort** sur `evaluation_log`. **Réserve** : le check « gates recomputés » est approximatif (prix entrée = VWAP ask d'exécution vs mid Gamma au signal, `hoursToResolution` proxy 24h, config actuelle vs à l'entrée) → il peut rater des violations réelles. 2 warns ops. |

---

## 1. Stratégie en place

### Pipeline

```
WeatherAutoTrackRule (villes)
  → WeatherStrategyRunner (poll)
      1. WeatherExitEvaluator
      2. discover + Open-Meteo forecast
      3. WeatherForecastStrategy.evaluate(chaque bucket actif)
      4. pickBestEdgeBucket (max edge YES)
  → runWeatherEntryPipeline → weather-order-signals
  → worker (fill + SL/TP/trailing)
```

### Règles d'entrée (code)

| Règle | Implémentation |
|---|---|
| BUY YES uniquement | `weather-forecast.strategy.ts` outcome/side forcés |
| `forecastYesProb > 0` | abstain `zero_forecast_probability` |
| `forecastYesProb ≥ minForecastProb` (si set) | abstain `forecast_probability_below_min` |
| `stdDev ≤ maxForecastStd` (si set) | abstain `forecast_too_uncertain` |
| `edge = forecastProb − yesPrice` | `weather-edge.ts` `calculateEdge` |
| `edge > resolveDynamicMinEdge(...)` | abstain `insufficient_edge` |
| Sélection bucket | **`pickBestEdgeBucket`** dans `strategy-runner.ts` (pas aligned) |
| 1 position / ville | runner + entry pipeline + snapshot city |
| Modes single/multi | `applySelectionMode` / `dedupSignalsByCity` |

### Règles de sortie (code)

| Priorité | Reason | Condition |
|---|---|---|
| 1 | `WEATHER_PRE_CLOSE` | `hoursToEnd ≤ closeBeforeResolutionHours` |
| 2 | `WEATHER_FORECAST_CHANGE` | `\|mean_now − mean_entry\| > threshold` |
| 3 | `WEATHER_BUCKET_EXIT` | hors palier + hysteresis + `close_and_reenter` |
| + | SL / TP / TRAILING | attachés à l'entrée, évalués worker |

---

## 2. Passage Doc → Code

| Élément Doc | Preuve Code | Statut | Observation |
|---|---|---|---|
| `selectForecastAlignedBucket` → BUY YES (`docs/weather-algo.md`) | `strategy-runner.ts` appelle `pickBestEdgeBucket` | ❌ Obsolète | Dead code live : `forecast-bucket-selector.ts` |
| Commentaire « forecast-aligned bucket » (`weather-forecast.strategy.ts`) | Runner best-edge | ⚠️ Divergent | Commentaire trompeur |
| Edge dynamique + minProb (`docs/code/08-weather-algo.md`) | `weather-forecast.strategy.ts` + `weather-edge.ts` | ✅ Conforme | |
| Sorties pre-close / drift / bucket (`docs/weather-algo.md`) | `weather-exit-evaluator.ts` | ✅ Conforme | |
| Métrique forcée `highest_temp` | `rule.metric` dans runner | ⚠️ Divergent | En pratique 44/44 rules = `highest_temp` |
| `add_position` coercé | `resolveCityFollowSwitchMode` | ✅ Conforme | |

---

## 3. Passage Code → Doc (lacunes)

| Lacune | Preuve | État Doc |
|---|---|---|
| `pickBestEdgeBucket` + tie-break centre | `strategy-runner.ts` | Absente de `weather-algo.md` ; présente dans `code/08` |
| Dual pre-close heures (algo) vs secondes (worker) | exit evaluator + worker policy | Vague / incomplet |
| Knobs ignorés (`sizingMode`, `signalScoreSizing`) | `weather-entry-pipeline.ts` hardcoded | Non documenté comme dead |
| Multi-stratégies proposées | spec `2026-08-08_SPEC_…` | Spec only — pas implémenté |

---

## 4. Audit BDD (conformité)

Config live : `enabled=true`, `minEdge=0.10`, `maxStd=1.5`, `minProb=0.30`, `multi/20`, `reentry=30s`, `entryUsdc=1`, `maxOpen=40`, `switch=close_and_reenter`.

| Check | Résultat | Fiabilité |
|---|---|---|
| BUY YES only | ✅ 13/13 | Forte |
| 1 pos active / ville | ✅ 4 actives | Moyenne (point-in-time ; ne couvre pas l'historique de recouvrement) |
| Snapshot forecast | ✅ | Forte |
| Gates entrée recomputés | ✅ 0 violation nette | **Faible à moyenne** : proxy 24h + prix exécution ≠ prix décision + config actuelle ; ne prouve pas l'absence de violation |
| `evaluation_log` signals vs edge/dyn | ✅ 92 signals / 2387 rows, 0 incohérent | **Forte** (valeurs stockées au moment de la décision) |
| Bucket-exit sous `hold` | ✅ N/A (`close_and_reenter`) | Forte |
| Forecast hors bucket à l'entrée | ℹ️ 9/12 (75%) — conforme au live best-edge | Forte (interprétation correcte) |
| KPI closed sim | ℹ️ 8 closed, 0 winners, realized **-2.12 USDC** ; 100% `WEATHER_BUCKET_EXIT` | Descriptive (pas de réconciliation worker seconds pre-close) |

**Limites du script** : le « 0 violation » des gates recomputés n'est qu'un plancher (edge > 5% absolu) ; la règle live stricte (`edge > dynamicThreshold`) n'est testée qu'en soft avec proxy horaire. Pour un verdict définitif il faudrait : join `weather_evaluation_log` ↔ positions sur le signal retenu, utiliser `opened_at`/`end_date` réels, comparer config à l'heure d'entrée, et vérifier re-entry throttle / sizing / pré-clôture secondes.

Abstentions dominantes : `forecast_probability_below_min` (2062), `insufficient_edge` (172).

Warns ops : `multi` + `maxSignals=20` ; `reentryThrottleMs=30000`.

Script reproductible :

```bash
npx tsx tools/weather-algo-rules-audit.ts
npx tsx tools/weather-algo-rules-audit.ts --json --out tmp/weather-rules-audit.json
```

---

## 5. Plan d'action

### 🔴 Critique (doc / définition)

1. **Corriger `docs/weather-algo.md`** : remplacer `selectForecastAlignedBucket` par `pickBestEdgeBucket` et expliquer la thèse « max edge parmi buckets éligibles ».
2. **Corriger le JSDoc** de `WeatherForecastStrategy` (plus « forecast-aligned »).

### 🟡 Majeure (ops / produit)

3. Remonter `weatherAlgoReentryThrottleMs` (défaut 30 min) — le 30s live explique le churn Austin.
4. Décider produit : garder best-edge (long-shots OK) **ou** revenir à forecast-aligned (thèse directionnelle).
5. Réduire `weatherAlgoMaxSignalsPerEvent` si mode `multi` conservé.

### 🟢 Mineure

6. Documenter knobs morts + dual pre-close.
7. Clarifier que multi-stratégies (`spread` / `convergence` / `arbitrage`) = spec non livrée.
