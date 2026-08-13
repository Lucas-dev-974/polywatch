# Audit stratégie `weather-forecast` — Weather Algo

**Date** : 2026-08-08
**Stratégie auditée** : `weather-forecast` (seule stratégie implémentée dans `@polywatch/weather-algo`)
**Mode** : Simulation
**Source données** : `tools/weather-algo-audit.ts --json` (snapshot 2026-08-07T22:54Z)
**Canvas associé** : [`weather-algo-audit.canvas.tsx`](../../.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-audit.canvas.tsx)

---

## 1. Description de la stratégie

La stratégie `weather-forecast` est une stratégie de **value bet** pure : elle compare la probabilité implicite d'une prévision météo avec le prix du marché Polymarket.

### Pipeline d'entrée

```
Villes surveillées (WeatherAutoTrackRule, 48 villes)
    │
    ▼
StrategyRunner (poll weatherAlgoPollMs = 30 min)
    │  1. ExitEvaluator (sorties d'abord)
    │  2. discoverWeatherMarkets + forecast Open-Meteo multi-modèles
    │  3. selectForecastAlignedBucket → BUY YES si edge OK
    ▼
runWeatherEntryPipeline → weather-order-signals
    │
    ▼
worker Executor
```

### Logique de décision (`weather-forecast.strategy.ts`)

1. **Récupération forecast** : Open-Meteo multi-modèles → `forecastMean` + `forecastStdDev` (°C)
2. **Sélection du palier** : `selectForecastAlignedBucket` choisit le bucket de température dont la fourchette contient `forecastMean` (priorité : `between` > `exact` > `or_above`/`or_below`)
3. **Probabilité forecast YES** : `computeMarketImpliedProbabilities` calcule la probabilité via distribution normale (CDF) selon le type de question :
   - `exact` : P(temp = X) = CDF(X+0.5) − CDF(X−0.5)
   - `between` : P(low ≤ temp ≤ high) = CDF(high+0.5) − CDF(low−0.5)
   - `or_above` / `or_below` : CDF cumulée
4. **Edge** : `edge = forecastYesProb − marketYesPrice` (`calculateEdge`)
5. **Seuil dynamique** : `resolveDynamicMinEdge(stdDev, hoursToResolution, baseEdge)` = max(5%, baseEdge + pénalité incertitude + facteur temps)
6. **Signal** : si `edge > seuil dynamique` ET `forecastYesProb ≥ minForecastProb` → BUY YES

La stratégie n'analyse **pas** le momentum, le volume, ni les mouvements de prix. Elle compare uniquement une prévision météo avec le prix du marché.

### Sorties (`weather-exit-evaluator.ts`)

Priorité (dans le même cycle, avant les entrées) :

1. `WEATHER_PRE_CLOSE` — `hoursToEnd ≤ closeBeforeResolutionHours` (prioritaire)
2. `WEATHER_FORECAST_CHANGE` — `|mean_now − mean_entry| > forecastChangeThreshold`
3. `WEATHER_BUCKET_EXIT` — forecast hors palier + hysteresis + mode `close_and_reenter`

Plus SL / TP / Trailing standards (résolus à l'entrée, évalués par le worker via `evaluateSlTpTrailing`).

---

## 2. Configuration active au moment de l'audit

| Paramètre | Valeur | Défaut code |
|---|---|---|
| `weatherAlgoEnabled` | `true` | `false` |
| `weatherAlgoSimEnabled` | `true` | `true` |
| `weatherAlgoMinEdge` | `0.10` | `0.10` |
| `weatherAlgoMaxForecastStd` | `1.5` | `null` |
| `weatherAlgoMinForecastProbability` | `0.30` | `null` (défaut stratégie `0.30`) |
| `weatherAlgoEntryUsdc` | `1` | `10` |
| `weatherAlgoSelectionMode` | `multi` | `single` |
| `weatherAlgoMaxSignalsPerEvent` | `20` | `3` |
| `weatherAlgoForecastChangeThreshold` | `2` | `2` |
| `weatherAlgoCloseBeforeResolutionHours` | `1` | `1` |
| `weatherAlgoPollMs` | `1800000` (30 min) | `1800000` |
| `weatherAlgoCityFollowSwitchMode` | `close_and_reenter` | `close_and_reenter` |
| `weatherAlgoBucketHysteresisPolls` | `2` | `2` |
| `weatherAlgoReentryThrottleMs` | `30000` (30s) | `1800000` (30 min) |
| `weatherAlgoMaxOpenPositions` | `40` | `10` |
| `weatherAlgoSlEnabled` | `true` | `true` |
| `weatherAlgoSlBidPoints` | `0.2` | `null` (défaut `0.10`) |
| `weatherAlgoTpEnabled` | `true` | `true` |
| `weatherAlgoTpBidPoints` | `1` | `null` (défaut `0.12`) |
| `weatherAlgoTrailingEnabled` | `true` | `true` |
| `weatherAlgoTrailingBidPoints` | `0.1` | `null` (défaut `0.05`) |
| `weatherAlgoPreCloseEnabled` | `true` | `true` |
| `simInitialCapitalWeather` | `20` | — |

---

## 3. Résultats de l'audit (données)

### 3.1 KPIs globaux

| Métrique | Valeur |
|---|---|
| Positions totales | 92 |
| Positions ouvertes | 8 |
| Positions fermées | 42 |
| Positions annulées | 42 |
| Capital sim initial | 20 USDC |
| PnL réalisé | -12.52 USDC |
| PnL non réalisé | -5.93 USDC |
| **PnL net total** | **-18.45 USDC (-92%)** |
| Gagnants | 11 |
| Perdants | 39 |
| **Win rate** | **11.96%** |
| Exécutions | 149 (90 filled, 55 failed, 4 no_payout) |
| Exit attempts totaux | 25 045 |
| Fees totaux | 3.12 USDC (17% du PnL net) |
| Slippage moyen | 1.57% |

### 3.2 Répartition par raison de clôture

| Raison | Count | PnL moyen | PnL total | Hold moyen (min) |
|---|---|---|---|---|
| `WEATHER_BUCKET_EXIT` | 20 | -0.34 | -6.87 | 117 |
| `WEATHER_PRE_CLOSE` | 13 | -0.16 | -2.07 | 425 |
| `TRAILING` | 4 | +0.77 | +3.09 | 489 |
| `REDEMPTION` | 4 | -1.70 | -6.80 | 756 |
| `SL` | 1 | -4.83 | -4.83 | 991 |
| `reservation_released` | 42 | 0 | 0 | — |

### 3.3 PnL par palier de prix d'entrée

| Palier | Positions | PnL total | Win rate |
|---|---|---|---|
| 0.00-0.05 | 9 | -1.12 | 11.11% |
| 0.05-0.10 | 14 | -5.01 | 14.29% |
| 0.10-0.20 | 11 | -2.73 | 18.18% |
| 0.20-0.35 | 3 | -0.47 | 33.33% |
| 0.35-0.50 | 3 | -3.08 | 66.67% |
| 0.50+ | 2 | -5.05 | 50% |

### 3.4 Top positions — tentatives de sortie bloquées

| Position | Ville | Exit attempts | Statut |
|---|---|---|---|
| #29994 | Sao Paulo | 7 859 | closed |
| #30339 | Hong Kong | 5 586 | open (stuck, marché terminé) |
| #29995 | Amsterdam | 5 149 | closed |
| #29999 | Lucknow | 3 930 | closed |
| #30012 | Shenzhen | 2 520 | closed |

### 3.5 Performance par ville (extrait)

| Ville | Positions | PnL total | Win rate |
|---|---|---|---|
| Lucknow | 1 | -5.13 | 0% |
| Denver | 3 | -4.35 | 66.67% |
| Madrid | 9 | -1.56 | 0% |
| Tokyo | 3 | +2.00 | 33.33% |
| Cape Town | 2 | +2.21 | 100% |

---

## 4. Constats d'audit

### C1 — Win rate catastrophique (11.96%)

Seulement 11 gagnants sur 92 positions. La stratégie entre sur des buckets low-price (entryPrice médian ~0.06 USDC) où la probabilité de résolution YES est structurellement faible. Le filtre `minForecastProb=0.30` ne suffit pas : pour les paliers `exact` (un seul degré), la probabilité YES intrinsèque est de 8-12% avec un std dev de 1°C, même quand le forecast mean est dans le bucket. Le forecast est une **estimation**, pas une certitude — l'incertitude fait que la température réelle dévie dans ~88% des cas.

### C2 — PnL net négatif — -18.45 USDC sur capital 20 (-92%)

Perte réalisée -12.52 + non réalisée -5.93 = -18.45 USDC. Le drawdown est critique, la session sim est proche de l'épuisement du capital.

### C3 — Bucket-exit dominant mais perdant (20 closes, -6.87 USDC)

`WEATHER_BUCKET_EXIT` est la raison de close la plus fréquente (20/42). Le forecast drift sort du palier avant que le marché ne résolve. Le mode `close_and_reenter` combiné au `reentryThrottleMs=30000` (30s) crée un cycle de ré-entrée immédiat sur le même bucket — le forecast n'a pas changé en 30s (Open-Meteo ne se met à jour pas à cette fréquence), donc l'algo recrée la même position perdante en boucle. Démonstration : Madrid a eu 9 positions, toutes en bucket-exit, toutes perdantes.

### C4 — REDEMPTION = perte moyenne max (-1.70 USDC / position)

4 positions `REDEMPTION` (marchés résolus sans close préalable, `liquidityStatus=illiquid`) totalisent -6.80 USDC. Les positions illiquides ne peuvent pas être fermées par l'algo et subissent la résolution du marché. Lucknow (-5.13) à elle seule représente la plus grosse perte unitaire.

### C5 — Position fantôme Hong Kong #30339

Position ouverte sur marché terminé (Aug 7), 5 586 exit attempts bloqués (`forced_exit_retries_exhausted`), `liquidityStatus=illiquid`. Cette position est **stuck** et ne se ferme jamais. Le pre-close n'a pas fermé à temps. Bug : l'evaluator boucle sur une position qui ne peut plus être fermée.

### C6 — 25 045 exit attempts — fuite Redis/DB excessive

25 045 événements `exit_attempt` pour 92 positions = ~272 par position en moyenne. Les positions illiquides (Sao Paulo 7 859, Hong Kong 5 586, Amsterdam 5 149) accumulent des milliers de tentatives bloquées. L'evaluator devrait désister après N échecs au lieu de boucler indéfiniment.

### C7 — Trailing = seule raison profitable (+0.77 USDC moyen)

Les 4 closes `TRAILING` (Tokyo +2.00, Chongqing +0.63, Wellington +0.39, Ankara +0.08) sont les seules rentables. Le trailing capture la momentum positive que le bucket-exit coupe prématurément. La stratégie est mieux servie par le trailing que par le bucket-exit.

### C8 — SL 0.2 bid points trop large pour low-price entries

Position Denver #30124 : `entryPrice=0.48`, SL déclenché à -4.83 USDC. Avec `slBidPoints=0.2`, le SL est à `entry - 0.2 = 0.28`, ce qui représente **-42%** sur une entrée à 0.48. Le SL en bid points absolus ne s'adapte pas au prix d'entrée. Une position à 0.05 USDC avec SL 0.2 serait fermée immédiatement (entry - SL = -0.15, impossible).

### C9 — EntryUsdc trop faible (1 USDC) — fees destructrices

Avec 1 USDC par position, le PnL par trade est inférieur à 0.50 USDC. Les fees (3.12 USDC pour 149 exécutions) représentent **17% du PnL net**. À 5-10 USDC par position, l'impact des fees serait dilué à 3-6%.

### C10 — 42 positions annulées (45%)

42 positions sur 92 sont `cancelled` (réservation relâchée avant exécution). Cela suggère que le pipeline d'entrée réserve des positions qui n'aboutissent pas — potentiellement à cause de la concurrence entre les 48 villes en mode `multi` avec `maxSignalsPerEvent=20`.

---

## 5. Recommandations

### R1 — Augmenter `minForecastProb` de 0.30 → 0.55 (immédiat, config)

**Problème** : Le filtre à 0.30 laisse passer des buckets où la probabilité YES est de 30-35%, c'est-à-dire des paris où le marché a 65-70% de chances d'avoir raison.

**Action** : Modifier `weatherAlgoMinForecastProbability` de 0.30 à 0.55 via l'UI (page Weather Algo → onglet Paramètres) ou via `PUT /api/config/weather`.

**Impact attendu** : Réduction du nombre de signaux (moins d'entrées), mais les entrées conservées auront une probabilité YES > 55%. Win rate attendu > 35%.

### R2 — Restaurer `reentryThrottleMs` à 1 800 000 (30 min) (immédiat, config)

**Problème** : `reentryThrottleMs=30000` (30s) permet une ré-entrée immédiate après bucket-exit, recréant le même pattern perdant. Le forecast ne change pas en 30s.

**Action** : Modifier `weatherAlgoReentryThrottleMs` de 30000 à 1800000 via l'UI ou API.

**Impact attendu** : Fin du cycle de ré-entrée sur le même bucket dans le même cycle de polling. Chaque ville ne sera ré-évaluée qu'au prochain poll (30 min).

### R3 — Augmenter `entryUsdc` de 1 → 5 (immédiat, config)

**Problème** : À 1 USDC par position, les fees (3.12 USDC) représentent 17% du PnL net.

**Action** : Modifier `weatherAlgoEntryUsdc` de 1 à 5 via l'UI ou API.

**Impact attendu** : Fees dilués à 0.7% du PnL. PnL par trade proportionnellement plus grand.

### R4 — Désactiver ou réduire le SL (immédiat, config)

**Problème** : `slBidPoints=0.2` en bid points absolus est inadapté aux entrées low-price. Sur entry 0.48, le SL représente -42%. Sur entry 0.05, le SL est sous le prix (impossible).

**Action** : Soit désactiver le SL (`weatherAlgoSlEnabled=false`), soit réduire `slBidPoints` à 0.03-0.05. Le trailing et le pre-close gèrent déjà les sorties.

**Impact attendu** : Évite les clôtures SL disproportionnées. Le trailing (déjà rentable +3.09 USDC) reste le mécanisme de sortie principal.

### R5 — Cap d'exit attempts à 50 par position (code, moyen)

**Problème** : 25 045 exit attempts pour 92 positions. Les positions illiquides accumulent des milliers de tentatives bloquées (Sao Paulo 7 859, Hong Kong 5 586).

**Action** : Ajouter un compteur d'exit attempts par position dans `WeatherExitEvaluator`. Après 50 tentatives échouées, marquer la position `failed` et relâcher.

**Fichier** : `packages/weather-algo/src/processors/weather-exit-evaluator.ts`

### R6 — Pre-close prioritaire sur marchés illiquides (code, moyen)

**Problème** : 4 positions `REDEMPTION` (-6.80 USDC) n'ont pas pu être fermées par l'algo. Le pre-close n'a pas anticipé l'illiquidité.

**Action** : Dans `WeatherExitEvaluator`, rendre le pre-close **inconditionnel** quand `liquidityStatus=illiquid` et `hoursToEnd < 3h`, même si le bid est faible. Mieux vaut une close partielle qu'une REDEMPTION.

**Fichier** : `packages/weather-algo/src/processors/weather-exit-evaluator.ts`

### R7 — Mode `hold` proche de la résolution (code, moyen)

**Problème** : Le mode `close_and_reenter` à moins de 3h de la résolution crée du churn inutile. Le forecast n'a plus le temps de changer significativement.

**Action** : Quand `hoursToEnd < 3h`, forcer `cityFollowSwitchMode=hold` (ignorer le bucket-exit, garder drift + pre-close actifs).

**Fichier** : `packages/weather-algo/src/processors/weather-exit-evaluator.ts`

### R8 — Réduire `maxSignalsPerEvent` de 20 → 5 (immédiat, config)

**Problème** : 42 positions annulées (45%) suggèrent une concurrence excessive en mode `multi` avec 20 signaux max. L'algo réserve des positions qui n'aboutissent pas.

**Action** : Modifier `weatherAlgoMaxSignalsPerEvent` de 20 à 5 via l'UI ou API.

**Impact attendu** : Moins de réservations inutiles, meilleures exécutions sur les signaux conservés.

---

## 6. Plan d'action

| Priorité | Recommandation | Type | Effort | Délai |
|---|---|---|---|---|
| P0 | R1 — `minForecastProb` 0.30 → 0.55 | Config | 0 ligne | Immédiat |
| P0 | R2 — `reentryThrottleMs` 30s → 30 min | Config | 0 ligne | Immédiat |
| P0 | R3 — `entryUsdc` 1 → 5 | Config | 0 ligne | Immédiat |
| P1 | R4 — SL désactivé ou réduit | Config | 0 ligne | Immédiat |
| P1 | R8 — `maxSignalsPerEvent` 20 → 5 | Config | 0 ligne | Immédiat |
| P2 | R5 — Cap exit attempts 50 | Code | ~30 lignes | Court terme |
| P2 | R6 — Pre-close illiquide forcé | Code | ~20 lignes | Court terme |
| P2 | R7 — Mode hold proche résolution | Code | ~15 lignes | Court terme |

### Validation

Après application des recommandations P0 (config seulement), observer une session complète (24-48h). Critères de succès :

- Win rate > 35%
- PnL net > 0 sur la session
- Exit attempts totaux < 500 (vs 25 045 actuellement)
- 0 position stuck (aucune `forced_exit_retries_exhausted`)

Si ces critères ne sont pas atteints, passer aux recommandations P2 (code).

---

## 7. Référence canvas

Le canvas de l'audit est disponible à :

```
C:\Users\lcsystem\.cursor\projects\c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1\canvases\weather-algo-audit.canvas.tsx
```

Il contient :
- KPIs globaux (PnL, win rate, capital)
- Pie chart — répartition par statut (open / closed / cancelled)
- Bar chart — PnL par raison de clôture
- Bar chart — PnL par palier de prix d'entrée
- Table — performance par ville (30 villes, tri PnL)
- Table — 8 positions ouvertes (forecast, liquidité, peak PnL)
- Table — 42 positions fermées (raison, hold time)
- Bar chart — top 5 positions par exit attempts
- Callouts — 8 constats d'audit
- Config active complète
- Recommandations détaillées