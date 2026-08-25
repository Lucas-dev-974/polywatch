# Audit Weather Algo — Moteur live (hors backtest)

> **Date :** 2026-08-25
> **Auteur :** Assistant IA (revue de conception + recoupement code)
> **Statut :** 🟡 **Bien conçu comme ossature, à revoir comme produit de trading**
> **Périmètre :** moteur live `packages/weather-algo` + domaine `packages/core/src/weather` + raccord worker (SL/TP). **Exclut** le moteur backtest (déjà audité par [`2026-08-23_audit-weather-backtest-complet.md`](./2026-08-23_audit-weather-backtest-complet.md) et [`2026-08-25_audit-weather-backtest-zero-holding-et-prix-stale.md`](./2026-08-25_audit-weather-backtest-zero-holding-et-prix-stale.md)).
> **Canvas compagnon :** [`weather-algo-engine-audit.canvas.tsx`](../../C:/Users/lcsystem/.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-engine-audit.canvas.tsx) — vue visuelle du pipeline, des modules et des constats, à ouvrir à côté du chat.

---

## 📋 Résumé exécutif

L'architecture est **saine** : process dédié, responsabilités claires, config par stratégie, gardes de risque, exits avant entrées, `weather-highest-yes` réellement indépendant du forecast. Elle n'est **pas finie** comme thèse de trading : le default live (`weather-forecast` / best-edge) chasse les queues, la date cible d'une position a **deux autorités**, et plusieurs knobs UI ne font rien en live (dont un retiré du code mais encore dans la doc).

| Question | Réponse |
|----------|---------|
| L'algo est-il bien conçu ? | **Oui comme système**, non comme stratégie par défaut |
| Points à revoir ? | **15 constats** (3 élevés, 7 moyens, 5 faibles) |
| Modules ? | **3 couches** : process, domaine core, worker |

**Recommandation d'ordre** : (1) une seule date d'autorité dans le signal ; (2) trancher produit sur best-edge vs aligned vs filtre des paliers bon marché ; (3) aligner la doc et les knobs morts ; (4) si multi-stratégies sur la même date est voulu, ne plus `return` au premier signal.

---

## 1. Le cycle live

```
Villes surveillées (WeatherAutoTrackRule)
        │
        ▼
WeatherStrategyRunner (poll weatherAlgoPollMs, aligné grille UTC)
        │  1. ExitEvaluator (sorties d'abord)
        │  2. discoverWeatherMarkets + forecast Open-Meteo
        │  3. evaluateGroup par stratégie active (catalogue, first-wins)
        │  4. dedupSignalsByCityDate + applySelectionMode
        ▼
runWeatherEntryPipeline → file Redis weather-order-signals
        │
        ▼
worker Executor (remplit l'ordre)
        │  + worker PositionExitEvaluator (SL/TP/trailing au tick)
```

- **Unité de sélection** = ville + date cible (+ horizon). **Unité d'exécution** = sous-marché (palier) choisi par la stratégie active.
- **Au plus `maxPositionsPerCityDate` positions ouvertes par (ville, date cible, stratégie)** (défaut 1).
- **Poll phasé grille UTC** : `Math.ceil(now/pollMs)×pollMs` depuis minuit UTC (ex. 15 min → :00/:15/:30/:45), stable d'un redémarrage à l'autre. Au boot : passe d'exit immédiate (reprise), premier cycle complet au prochain créneau aligné. `config-changed` force un cycle immédiat.
- **Sorties tournent même si `weatherAlgoEnabled = false`** (positions ouvertes).
- **Split sorties** : drift / bucket-exit au poll weather (evaluator dédié) ; SL / TP / trailing au **tick worker** (carnet), en % de la mise investie. Plus de `WEATHER_PRE_CLOSE` (retiré — migration `0116`).

---

## 2. Les modules

### 2.1 Process `@polywatch/weather-algo` (boucle live)

| Module | Fichier | Rôle | Note audit |
|---|---|---|---|
| Bootstrap | `src/index.ts` | DB, Redis ×3 (cmd/pub/sub), registry, WS, files, heartbeat, reload config, shutdown | Pas de `shuttingDown` (contrairement à crypto-algo) — entrée possible entre SIGTERM et `process.exit` |
| StrategyRunner | `src/strategy/strategy-runner.ts` | Horloge UTC, exits puis city-follow, snapshots, capacité ville+date+strategie | Tient la route ; `return` au premier signal (cf. constat #4) |
| Selection | `src/strategy/strategy-runner-selection.ts` | Dedup par lane (ville+date+stratégie), mode `single` (meilleure paire ville+date) / `multi` | `single` écrit pour renvoyer « toutes les stratégies de la paire » — chemin jamais alimenté |
| `weather-forecast` | `src/strategy/weather-forecast.strategy.ts` | Tous les paliers actifs, `pickBestEdgeBucket` (max edge YES) | **Default live** — chasse les queues (cf. constat #2) |
| `weather-forecast-aligned` | `src/strategy/weather-forecast-aligned.strategy.ts` | Palier dont la fourchette contient le forecast mean, puis gates edge | Sous-ensemble de forecast avec les mêmes gates (cf. constat #5) |
| `weather-highest-yes` | `src/strategy/weather-highest-yes.strategy.ts` | Consensus marché, sans forecast, `edge=0`, hold jusqu'à résolution | Bien isolé ; skip forecast dans l'exit evaluator (pas de close fantôme) |
| Gates forecast | `src/strategy/evaluate-bucket-gate.ts` | Proba CDF, `resolveDynamicMinEdge`, std max, token YES | Lit les prix Gamma, pas CLOB (cf. constat #3) |
| Entry pipeline | `src/processors/weather-entry-pipeline.ts` | Cooldown, throttle, cap re-entries, kill-switch, MOS, reserve, enqueue | Robuste ; knobs UI non lus (cf. constat #7) |
| Exit evaluator | `src/processors/weather-exit-evaluator.ts` | Drift forecast + bucket-exit + hystérésis | **Pas de pre-close** (retiré) — la doc dit le contraire (cf. constat #8) |
| Observabilité | `src/runtime-status.ts`, `src/metrics-publisher.ts` | Redis runtime-status, parse rate questions | OK |

### 2.2 Domaine `@polywatch/core` weather (maths + données)

| Module | Emplacement | Rôle pour l'algo |
|---|---|---|
| Catalogue + bags | `core/weather/strategy-catalog.ts` | IDs, `getStrategyParams`, defaults, coercition `0 → null`, sanitize |
| CDF / edge | `forecast-distribution.ts`, `weather-edge.ts` | Proba YES (bins 1 °C), `calculateEdge`, `resolveDynamicMinEdge` |
| Aligned picker | `forecast-bucket-selector.ts` | `selectForecastAlignedBucket` (between > exact > tails) |
| Sorties pures | `weather-exit-helpers.ts` | Drift, in-bucket, hystérésis, look-ahead dates |
| Discovery | `weather-market-discovery.ts` | Gamma tag `weather`, parse question, date cible (`resolveMarketTargetDateIso`) |
| Forecast | `weather-api-client.ts` + `WeatherForecastService` | Geocode Open-Meteo + 5 modèles, cache TTL |
| Redis gardes | `weather-reentry-throttle.ts`, `weather-reentry-count.ts`, `weather-bucket-hysteresis.ts` | Pause re-entry, cap entrees, compteur bucket leave |
| SL après close | `weather-reentry-after-sl.ts` (appelé par worker) | Throttle ville+date après sortie SL |
| Risque | `ReservationService`, `RiskService` | `maxOpen` / `exposure` / `daily loss` / kill-switch par `strategyId` |

### 2.3 Worker (pas dans le package weather, mais partie du moteur)

- Files : `weather-order-signals` (`WEATHER_OPEN`), `close-signals` (`WEATHER_FORECAST_CHANGE`, `WEATHER_BUCKET_EXIT`).
- SL / TP / trailing en **% de la mise investie** (cost basis + frais), defaults `WEATHER_EXIT_DEFAULTS` = `slPercent: 20`, `tpPercent: 25`, `trailingPercent: 10`, `trailingActivationPercent: 12` quand le bag laisse `null`.
- `getWeatherPreCloseParams` retourne `preCloseEnabled: false` — pre-close **éteint**.
- Confirmation SL : `getWeatherSlConfirmationTicks(cfg, strategyId)` (ticks consécutifs requis).

---

## 3. Les trois stratégies

| Stratégie | Thèse | Quand elle trade | Sorties spécifiques |
|---|---|---|---|
| `weather-forecast` | Value bet : le marché sous-prix un palier vs CDF | Dès qu'un palier passe les gates, celui au **max edge** | Drift + bucket-exit (si `close_and_reenter`) |
| `weather-forecast-aligned` | Directionnel : le palier qui contient le mean | Si ce palier passe les **mêmes gates edge** | Idem forecast |
| `weather-highest-yes` | Filet : consensus, pas de vue forecast | Si forecast strategies s'abstiennent (first-wins) **et** `yesPrice` dans `[minYesPrice, maxYesPrice]` | Aucune. Hold jusqu'à résolution / SL/TP worker |

**Catalogue order = priorité** (first-wins). `weather-highest-yes` a `edge=0` pour ne jamais gagner un tie contre un signal forecast. En mode `single`, une seule paire (ville, date) est retenue dans tout le cycle — un signal forecast sur Paris J+1 masque un `highest-yes` sur Austin.

`weather-highest-yes` est le seul filet quand le forecast est indisponible : les stratégies forecast s'abstiennent (`forecast_unavailable`), `highest-yes` s'évalue avec un ctx placeholder `{0, 0}`.

---

## 4. Constats à revoir

### 🔴 Élevés

#### #1 — Deux dates cibles : question vs `endDate`

**Lieu** : `strategy-runner.ts` (grouping / forecast) vs `strategy.ts` / `evaluate-bucket-gate.ts` (signal persisté).

Le runner groupe et fetch le forecast sur la **date de la question** (`dateKey` depuis `parseWeatherQuestion`). Le signal stocke `market.endDate` comme `targetDate`. Si le marché se résout le lendemain de la date de question (fréquent), alors :

- la **capacité** est pré-filtrée sur `dateKey` (question),
- le **cache forecast** au persist utilise `signal.targetDate` (endDate),
- le **cap Redis** et la **sélection `single`** parlent de `endDate`.

Résultat : capacité, cache, cap et sélection peuvent diverger sur un même marché. Une seule date d'autorité devrait être injectée dans le signal.

#### #2 — Best-edge = chasse aux long-shots

**Lieu** : `bucket-selection.ts` → `pickBestEdgeBucket`.

`pickBestEdgeBucket` maximise `forecastProb − yesPrice`. Un palier à quelques cents avec une queue CDF (or_above / or_below) gagne contre le palier aligné. C'est le **default live** (`weather-forecast`). Déjà visible dans le PnL live historique (paliers `0.00–0.20` dominent, win rate bas). Décision produit à trancher : garder best-edge, passer aligned en default, ou filtrer les paliers trop bon marché (`minForecastProbability`, `maxYesPrice` sur forecast).

#### #3 — Prix de décision (Gamma) ≠ prix d'exécution (CLOB)

**Lieu** : `evaluate-bucket-gate.ts` (lit `market.outcomePrices`) ; `weather-entry-pipeline.ts` (refetch `fetchExecutablePrices`).

Les stratégies décident sur `outcomePrices` Gamma. L'entry pipeline refetch un ask VWAP executable côté CLOB. L'edge du signal peut avoir disparu au fill — il n'y a pas de ré-évaluation de l'edge contre le prix CLOB avant enqueue (seulement MOS / liquidité / depth).

### 🟡 Moyens

#### #4 — First-wins vs « toutes les lanes »

**Lieu** : `strategy-runner.ts` → `evaluateCityFollowDateGroup` ; `strategy-runner-selection.ts` → `applySelectionMode('single')`.

`evaluateCityFollowDateGroup` s'arrête au **premier signal** (`return result.signal`). `applySelectionMode('single')` est écrit pour renvoyer toutes les stratégies de la paire gagnante — ce chemin n'est jamais alimenté. Soit admettre que `single` = un seul signal par cycle, soit cesser de `return` au premier signal si le multi-stratégies sur la même date est voulu.

#### #5 — `weather-forecast` + `weather-forecast-aligned` avec les mêmes gates

**Lieu** : `evaluate-bucket-gate.ts` (partagé).

Aligned est un sous-ensemble de forecast (le palier du mean est un des paliers évalués par forecast). Si forecast est actif avec les mêmes `minEdge` / `maxForecastStd` / `minForecastProbability`, aligned ne produit jamais un trade distinct (first-wins catalogue). Les différencier exige des gates différents ou désactiver forecast.

#### #6 — `allowedComparisons` : UI string, runtime tableau

**Lieu** : `strategy-catalog.ts` (schema UI select, default `'exact'`) ; `weather-highest-yes.strategy.ts` (attend `WeatherComparison[]`).

Le `SelectField` persiste une string (le schema déclare `default: 'exact'`). Le bag typé attend `WeatherComparison[] | null` (`null` = tout accepter). Un save UI peut forcer `exact`-only alors que le catalogue documente `null` = tout. Incohérence de typage UI/runtime.

#### #7 — Knobs UI sans effet live

**Lieu** : `strategy-catalog.ts` (bag) ; `weather-entry-pipeline.ts` (consommé).

- `minTimeToAskRatio` : getter `policy.ts`, jamais appelé par weather-algo (crypto/copy l'utilisent).
- `allowedMarketTags` : sanitized, pas de champ UI météo.
- `signalScoreSizingEnabled` : lu, mais `signalScore.multiplier` est hardcodé à `1` dans l'entry pipeline.
- `minTimeToClose` : dans le bag, pas lu par entry weather (crypto l'utilise).

Soit brancher, soit retirer du bag / de l'UI pour éviter la confusion.

#### #8 — Doc pre-close vs code

**Lieu** : `DropWeatherPreClose1700000000116.ts` (supprime `closeBeforeResolutionHours`) ; `policy.ts` → `getWeatherPreCloseParams` retourne `false` ; `docs/weather-algo.md` et `docs/code/08-weather-algo.md` décrivent encore `WEATHER_PRE_CLOSE` comme prioritaire.

La feature a été retirée du code (positions tenues jusqu'à résolution / SL/TP / drift / bucket), mais la doc produit et la doc code la mentionnent encore comme active. Migration de doc à faire.

#### #9 — Snapshot forecast fail-open

**Lieu** : `weather-entry-pipeline.ts` → `persistEntryForecastSnapshot` (try/catch, entry still enqueued) ; `weather-exit-evaluator.ts` (skip sans snapshot).

Si `saveIfAbsent` échoue, l'ordre part quand même. L'exit evaluator, sans snapshot, ne peut évaluer ni drift ni bucket-exit — la position reste ouverte jusqu'à résolution / SL/TP worker. Le compteur de capacité ville+date peut aussi rater la position. Le fail-open est intentionnel (ne pas bloquer l'entry pour un souci d'audit), mais l'absence de garde-feneil sur la capacité mérite un regard.

#### #10 — Compteur Redis d'entrées sans TTL

**Lieu** : `core/redis/weather-reentry-count.ts` → `incrementWeatherReentryCount` fait `INCR` nu, sans `EXPIRE`.

Le cap `maxReentriesPerCityDate` fonctionne, mais les clés `weather-entry-count:{city}:{dateIso}:{strategyId}:{mode}` s'accumulent tant que Redis n'est pas flushé. TTL à ajouter (ex. durée de vie d'un marché météo, ~qq jours).

### 🟢 Faibles

#### #11 — Pas de `shuttingDown`

**Lieu** : `index.ts` (shutdown) vs `crypto-algo` qui a un flag `shuttingDown` anti re-entrance.

Weather-algo peut encore enqueuer une entrée entre SIGTERM et `process.exit(0)`. Pas critique (l'executor du worker gère la cohérence), mais inconsistant avec le crypto-algo.

#### #12 — BUY YES uniquement

**Lieu** : `evaluate-bucket-gate.ts` (signal `outcome: 'YES'`).

Un edge négatif (marché trop cher vs forecast) n'ouvre jamais de NO. Moitié de la surface d'edge ignorée, par choix. Décision produit à expliciter.

#### #13 — Std = désaccord de modèles, pas l'erreur vraie

**Lieu** : `weather-api-client.ts` (5 modèles Open-Meteo) ; `weather-edge.ts` (`resolveDynamicMinEdge` pénalité `+5 %/°C` de std).

Cinq modèles Open-Meteo. S'ils sont biaisés ensemble, le std est faible et le seuil dynamique baisse à tort. Le geocode prend le 1er hit (`Paris` → Paris, TX possible). `resolveWeatherDate` prend l'année civile courante (fragile autour de minuit le 31/12).

#### #14 — Throttle re-entry transversal

**Lieu** : `weather-reentry-throttle.ts` (clé `weather-reentry:{city}:{dateIso}:{mode}`).

La clé ne contient pas `strategyId`. Un close forecast pose un throttle qui bloque aussi `highest-yes` sur la même paire pendant `reentryThrottleMs`. Probablement voulu (évite le ping-pong), mais à documenter.

#### #15 — Cadences asymétriques

**Lieu** : `strategy-runner.ts` (poll) vs worker `position-exit-evaluator.ts` (tick).

Drift / bucket au plus toutes les `pollMs` (défaut 30 min). SL/TP au tick worker. WS Polymarket est connecté au boot mais **ne déclenche pas l'eval** (poll-driven). Conséquence : une position peut déraper sur SL entre deux polls sans que le runner le voie.

---

## 5. Knobs : live vs décoratif

Compte des clés `WeatherStrategyParamsBag` effectivement consommées par runner, entry, exit weather ou worker, vs clés présentes en UI / bag sans effet live.

| Knob | État |
|---|---|
| `minTimeToClose` | Dans le bag, pas dans entry weather (crypto l'utilise) |
| `minBidToAskRatio` | Getter `policy.ts`, jamais appelé par weather-algo |
| `allowedMarketTags` | Sanitized, pas de champ UI météo |
| `signalScoreSizingEnabled` | Lu, mais multiplier forcé à `1` |
| `pre-close / `closeBeforeResolutionHours`` | Retiré (`0116`), encore dans la doc |

---

## 6. Ce qui tient

Pour équilibrer le tableau, les points solides du moteur :

- **Poll grille UTC** stable d'un redémarrage à l'autre.
- **Passe d'exit au boot** (reprise positions ouvertes).
- **Reload config à chaud** (`config-changed` → reload + cycle immédiat).
- **Kill-switch et limites de réserve par `strategyId`** (filtrage positions + réservations).
- **Hystérésis bucket** (compteur Redis, `bucketHysteresisPolls`).
- **Throttle re-entry** ville+date+mode.
- **`weather-highest-yes` sans forecast** (skip fetch forecast dans l'exit evaluator — évite la close fantôme via `entryForecastMean=0`).
- **Standby entries si désactivé, sorties conservées** (positions ouvertes).
- **Capacité ville+date+strategie** défensive (`seenCityDates` + filtre `openCityDates`).
- **Process isolé** (Redis ×3 dédiés, queue dédiée `weather-order-signals`).

---

## 7. Réponse directe

### Est-ce que l'algo est bien conçue ?

**Oui comme système** : responsabilités claires, process dédié, config par stratégie, gardes de risque, exits avant entrées, `highest-yes` réellement indépendant du forecast. **Non comme thèse de trading par défaut** : best-edge sur une loi normale et des prix Gamma produit des paris queue, et la date d'identité d'une position n'est pas unique.

### Par où commencer

1. **Une seule date d'autorité** dans le signal (date de question / `dateKey`), plus `endDate`.
2. **Trancher produit** : garder best-edge, ou passer aligned en default, ou exiger `minForecastProbability` / interdire les paliers `< 0.20`.
3. **Aligner la doc** (pre-close mort) et **retirer ou brancher** les knobs morts.
4. **Si multi-stratégies sur la même date est voulu**, ne plus `return` au premier signal.

---

## 8. Références

- Canvas compagnon : [`weather-algo-engine-audit.canvas.tsx`](../../C:/Users/lcsystem/.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-engine-audit.canvas.tsx)
- Doc produit : [`docs/weather-algo.md`](../weather-algo.md)
- Doc code : [`docs/code/08-weather-algo.md`](../code/08-weather-algo.md)
- Issues ouvertes : [`docs/weather-algo-audits-plans/ISSUES-OUVERTES.md`](../weather-algo-audits-plans/ISSUES-OUVERTES.md)
- Audits backtest (hors périmètre) : [`2026-08-23_audit-weather-backtest-complet.md`](./2026-08-23_audit-weather-backtest-complet.md), [`2026-08-25_audit-weather-backtest-zero-holding-et-prix-stale.md`](./2026-08-25_audit-weather-backtest-zero-holding-et-prix-stale.md)
- Audit `highest-yes` edge cases : [`2026-08-15_audit-weather-algo-highest-yes-edge-cases.md`](./2026-08-15_audit-weather-algo-highest-yes-edge-cases.md)