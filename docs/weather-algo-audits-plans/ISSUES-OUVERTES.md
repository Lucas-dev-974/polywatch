# Issues ouvertes — Weather Algo

> Dernière mise à jour : 2026-08-13
> Centralise les issues **encore ouvertes** identifiées dans les audits/plans du dossier `weather-algo-audits-plans`.
> **Exclu** : les tests d'observation (laisser tourner l'algo puis re-générer un audit) — voir §5.

---

## 1. Plans non implémentés / partiellement implémentés

### 1.1 `2026-08-13_PLAN-fix-c7-c10-c11-c12-weather-algo.md` — ✅ **implémenté (vérifié 2026-08-13)**

Les quatre constats C7, C10, C11, C12 sont **déjà corrigés dans le code** (vérification directe du code + tests) :

| Constat | Sévérité | État | Preuve |
|---------|----------|------|--------|
| **C7** | 🟡 Moyenne | ✅ implémenté | `resolution.ts:35` → `proxyFallback: false` sur forecast présent ; `:25` → `true` sur forecast `null` |
| **C10** | 🔴 Critique | ✅ implémenté | `forecast-distribution.ts` → `computeCdfBelow(target) = normalCDF(target + 0.5)` ; tests de symétrie dans `forecast-distribution.test.ts` |
| **C11** | 🟡 Moyenne | ✅ implémenté | `weather-exit-helpers.ts` → `or_below` `<= target + 0.5`, `or_above` `>= target - 0.5` ; tests de limite dans `weather-exit-helpers.test.ts` |
| **C12** | 🟡 Moyenne | ✅ implémenté | `metric` ajouté à l'index unique de `WeatherClobPriceHistory` + conflictTarget `orUpdate` + migration `AddMetricToClobHistoryUniqueKey1700000000110` enregistrée dans `data-source.ts` |

**Aucune action requise** — le plan est clos. Reste uniquement les smoke tests prod (§2).

### 1.2 `2026-08-10_PLAN-weather-clob-history-intervals.md` — **Plan (à implémenter)**

Gestion multi-intervalles de l'historique CLOB + refonte colonne « En base » :

- Migration `AddClobHistoryIntervalToUniqueKey1700000000104` (clé `(condition_id, side, recorded_at, fidelity_minutes)`)
- Coverage enrichi `intervals` dans `WeatherHistoryCoverageDto`
- `deleteCityInterval` + endpoint `DELETE /interval`
- Filtre timeline CLOB par `fidelityMinutes`
- Refonte UI colonne « En base » (badges d'intervalle) + filtre timeline

> ⚠️ La migration `...0104` est référencée comme pattern existant dans le plan C12 — vérifier l'état réel (partiellement fait ?).

### 1.3 `2026-08-09_PLAN-weather-multi-strategy-extensible.md` — **partiellement implémenté**

| Item | État |
|------|------|
| Badge UI `strategyId` sur positions / exécutions | ❌ ouvert |
| Tests dédiés safe-reload + E2E `activeStrategies` | ❌ ouvert |
| `runner-sim` multi-stratégies (sans forcer un seul `strategyId`) | ❌ ouvert (UI passe toujours `strategyId`) |
| SPEC spread / convergence / arbitrage | ❌ futur (hors cette étape) |

---

## 2. Reste à faire en prod (migrations / smoke tests)

| Plan | Action prod restante |
|------|----------------------|
| `2026-08-13_PLAN-fix-c7-c10-c11-c12` | Exécuter la migration `AddMetricToClobHistoryUniqueKey1700000000110` ; smoke test ingest (2 métriques distinctes sur un même `conditionId` → pas de collision) ; smoke test backtest `proxyFallback` correct selon la présence du forecast |
| `2026-08-12_PLAN-fix-c1-c2` | Exécuter la migration `AddUnitToWeatherPositionForecast` ; smoke test route `GET /weather-algo-forecasts/:city/:date` (`isFresh: true`) ; smoke test UI bucket labels `°C`/`°F` ; vérifier log `forecastHistoryRecorder.record` ; rollback test `migrate:revert` |
| `2026-08-12_PLAN-fix-c3-c4-c5` | Smoke tests routes : `DELETE /tables/:id` (200/400), `GET /backtest/:id/positions?exitReason=...`, `GET /weather-algo-forecasts?metric=temp` (400), ingest `metric` invalide (400) |
| `2026-08-13_PLAN-fix-t1-t7` | Smoke test backend `GET /api/weather-algo-history/jobs` ; timer stale-sweep annulé au SIGTERM/SIGINT ; UI unmount pendant poll sans warning post-unmount |
| `2026-08-13_PLAN-refactor-r1-r10` | Redémarrer Vite (ou vider `node_modules/.vite`) pour le sous-chemin `@polywatch/core/backtest/exit-reasons` ; smoke test UI onglets Backtest / Données / timelines / watched-cities |

---

## 3. Hors scope / non livrés

| Issue | Source | Description |
|-------|--------|-------------|
| **Warnings quantitatifs backtest §12.2** | `2026-08-08_PLAN-weather-market-data-persistence.md` | `inactiveBucketsExcluded`, `arbitrage_unreliable`, `missingSnapshots`, `yesPriceNulls`, `noPriceNulls`, `forecastRevisionsPerDay`, `snapshotsPerDay` — non implémentés dans `packages/backtest` |
| **Socket.IO `backtest:*`** | `2026-08-09_audit-weather-algo-backtest.md` | Resté hors livrable |
| **Prometheus `polywatch_backtest_*`** | `2026-08-09_audit-weather-algo-backtest.md` | Resté hors livrable |
| **D12 — champs `WeatherConfig` non lus (~30 legacy)** | `2026-08-11_audit-weather-algo-complet.md` | Cross-check champ par champ non fait — audit futur dans un plan dédié |

---

## 4. Recommandations d'audit (ops / produit / code)

### 4.1 `2026-08-08_audit-weather-forecast-strategy.md`

| # | Recommandation | Type |
|---|----------------|------|
| R5 | Cap d'exit attempts à 50 par position (`weather-exit-evaluator.ts`) | Code |
| R6 | Pre-close inconditionnel si `liquidityStatus=illiquid` et `hoursToEnd < 3h` | Code |
| R7 | Forcer `cityFollowSwitchMode=hold` si `hoursToEnd < 3h` | Code |
| P3 | Métrique Prometheus `weather_open_positions` / `weather_pnl` labellisées | Code |
| P3 | Investiguer le slippage 96 % sur pos#29557 | Ops |

### 4.2 `2026-08-09_audit-weather-algo-strategy-live.md`

| # | Recommandation | Type |
|---|----------------|------|
| 3 | Remonter `weatherAlgoReentryThrottleMs` (défaut 30 min) — le 30 s live explique le churn Austin | Ops/produit |
| 4 | Décider produit : garder best-edge (long-shots OK) **ou** revenir à forecast-aligned | Produit |
| 5 | Réduire `weatherAlgoMaxSignalsPerEvent` si mode `multi` conservé | Ops |
| 6 | Documenter knobs morts + dual pre-close (heures vs secondes) | Doc |
| 7 | Clarifier que multi-stratégies (`spread`/`convergence`/`arbitrage`) = spec non livrée | Doc |

### 4.3 `audit-weather-algo-2026-08-04.md`

| # | Recommandation | Type |
|---|----------------|------|
| P3 | Métrique Prometheus `weather_open_positions` / `weather_pnl` labellisées | Code |
| P3 | Investiguer le slippage 96 % sur pos#29557 | Ops |

---

## 5. Tests d'observation (exclus de cette liste)

- Laisser tourner l'algo quelques cycles (30 min) puis re-générer l'audit pour vérifier : plus de long-shots, cancellations attribuées dans les logs pino, sorties SL/TP/pre-close/bucket-exit sur les positions ouvertes (`audit-weather-algo-2026-08-04.md`).
- Observation d'une session complète (24-48 h) après application des recommandations P0 config (`2026-08-08_audit-weather-forecast-strategy.md` §6 Validation).
