# Inventaire des plans — Polywatch

> Dernière mise à jour : 2026-08-27  
> Critère `applied/` : plan d'implémentation dont les livrables concrets sont présents dans le code (vérification codebase, pas seulement les cases `[x]` du markdown).

## Structure des dossiers

| Dossier | Contenu |
|---------|---------|
| *(racine)* | Plans **actifs** (partial / not_implemented) + cet INDEX |
| [`applied/`](applied/) | Plans **100 % implémentés** |
| [`reference/`](reference/) | Spec / analysis / report / matrix / annexe (pas des plans d'impl) |
| [`archived/`](archived/) | Plans **obsolètes / remplacés / abandonnés** |

## Synthèse

| Statut | Nombre |
|--------|--------|
| **applied** | 38 |
| **partial** (racine) | 3 |
| **not_implemented** (racine) | 2 |
| **reference** | 7 |
| **archived** | 7 |
| **Total** | **57** |

---

## Plans appliqués (`applied/`)

| Fichier | Résumé | Preuve code |
|---------|--------|-------------|
| [applied/IMPLEMENTATION_PLAN_CRYPTO_ALGO_V2.md](applied/IMPLEMENTATION_PLAN_CRYPTO_ALGO_V2.md) | Correctifs short-term Up/Down (WS mid, outcomes, Gamma TTL, resolve) | `naive-momentum.strategy.ts`, `strategy-runner.ts`, `price-feed.ts` |
| [applied/crypto-algo-worker.md](applied/crypto-algo-worker.md) | Scaffold Phase 1 crypto-algo (package, API, UI, runner, entry pipeline) | `packages/crypto-algo/`, routes `algo-markets`, frontend algo stores |
| [applied/crypto-algo-phase2.md](applied/crypto-algo-phase2.md) | ConnectionManager réel, cash disponible, outcomePrices Gamma | `connection-manager.ts`, `real-cash.ts`, `strategy-runner.ts` |
| [applied/2026-07-07_PLAN_ENRICHIR_DIALOGUE_NON_CRYPTO.md](applied/2026-07-07_PLAN_ENRICHIR_DIALOGUE_NON_CRYPTO.md) | Enrichissement dialog chart marchés non-crypto (Phase 3 backend reportée) | `MarketChartDialog.tsx`, `UpDownPriceChart.tsx`, `MarketChartDebugPanel.tsx` |
| [applied/2026-07-09_PLAN_FIX_STRATEGY_SPREAD_GAMMA_TOKEN_MIXUP.md](applied/2026-07-09_PLAN_FIX_STRATEGY_SPREAD_GAMMA_TOKEN_MIXUP.md) | Dual books WS/Gamma, WS comme trigger pur (bugs A1–A3) | `price-feed.ts`, `strategy.ts`, `naive-momentum.strategy.ts` |
| [applied/2026-07-09_PLAN_FIX_PIPELINE_STALENESS_OBSERVABILITE.md](applied/2026-07-09_PLAN_FIX_PIPELINE_STALENESS_OBSERVABILITE.md) | Staleness B1–B6 (book age, spread abs, abstain reasons) | `MAX_BOOK_AGE_MS`, `SPREAD_ABS_BY_INTERVAL`, migration abstain ticks |
| [applied/2026-07-10_PLAN_FIX_AUDIT_POST_TUNABLES.md](applied/2026-07-10_PLAN_FIX_AUDIT_POST_TUNABLES.md) | Correctifs C1–C6 post-tunables (illiquid/stale, debounce, serialization) | `price-feed.ts`, `strategy-runner.ts`, tests naive-momentum |
| [applied/2026-07-10_PLAN_PATCH_C7_TUNABLES_DEBT.md](applied/2026-07-10_PLAN_PATCH_C7_TUNABLES_DEBT.md) | Dette C7 : defaults uniques, API null vs `{}`, UI JSON invalid | `crypto-algo-tunables.ts`, `CryptoAlgoSettingsDialog.tsx` |
| [applied/2026-07-11_PLAN_DIALOG_RESET_SESSION_ARCHIVAGE.md](applied/2026-07-11_PLAN_DIALOG_RESET_SESSION_ARCHIVAGE.md) | Dialog reset sim + archive-before-wipe | `NewSessionResetDialog.tsx`, `simulation-reset-archive.service.ts` |
| [applied/2026-07-12_PLAN_CRYPTO_ALGO_EXECUTION_HARDENING.md](applied/2026-07-12_PLAN_CRYPTO_ALGO_EXECUTION_HARDENING.md) | Hardening enqueue/resume/cooldown/pubsub + e2e | `entry-enqueue-retry.ts`, `algo-entry-cooldown.ts`, e2e hardening |
| [applied/2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md](applied/2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md) | Hygiène Redis cohérente au sim-reset | `sim-reset-redis-hygiene.ts`, e2e sim-reset |
| [applied/2026-07-12_PLAN_REDEMPTION_PHASE2.md](applied/2026-07-12_PLAN_REDEMPTION_PHASE2.md) | Redemption réelle MVP (#22441 / #22539) | `clob-redeem.ts`, `redemption-handler.ts`, `wallet-history.ts` |
| [applied/2026-07-15_PLAN_SYSTEM_OVERVIEW_TAB.md](applied/2026-07-15_PLAN_SYSTEM_OVERVIEW_TAB.md) | Onglet System Overview (health, queues, audit WS) | `SystemOverviewPage.tsx`, `system-audit-runner.ts` |
| [applied/PLAN_LOCAL_PRICE_HISTORY.md](applied/PLAN_LOCAL_PRICE_HISTORY.md) | Ticks locaux 1 Hz Postgres pour charts algo | `AlgoPriceTick.ts`, `price-tick-recorder.ts`, `algo-market-chart.ts` |
| [applied/2026-08-06_PLAN-p0-implementation.md](applied/2026-08-06_PLAN-p0-implementation.md) | P0 : purge RiskConfig, extract sim/real, shutdown/race fixes | `BaseConfigService`, `decision-collector-shared.ts`, `shutdown.ts` |
| [applied/2026-08-06_PLAN-audit-global-codebase-doc-bugs-fantomes.md](applied/2026-08-06_PLAN-audit-global-codebase-doc-bugs-fantomes.md) | Audit global + remédiations closes (Phases 1–5) | Remédiations C4/C5/C9, sim-reset abort, SL/TP fail-closed |
| [applied/2026-07-05_PLAN_P0_METRIQUES.md](applied/2026-07-05_PLAN_P0_METRIQUES.md) | Métriques Prometheus P0 (exits, cycles, freshness) | `MetricsReporter`, `strategy-cycle-metrics.ts`, routes internal metrics |
| [applied/2026-07-05_PLAN_PATCH_CRYPTO_ALGO_EXITS.md](applied/2026-07-05_PLAN_PATCH_CRYPTO_ALGO_EXITS.md) | Pre-close unique ; purge SOFT/HARD/`TIME_EXIT` | UI crypto/weather, docs code, tests, audit tools |
| [applied/PLAN_REFACTOR_REMOVE_SQLITE.md](applied/PLAN_REFACTOR_REMOVE_SQLITE.md) | Suppression SQLite, Postgres-only + pg-mem | `data-source.ts` Postgres-only, `test-data-source.ts` pg-mem, docker PG, docs nettoyées |
| [applied/2026-08-07_PLAN-fix-audit-hardening.md](applied/2026-08-07_PLAN-fix-audit-hardening.md) | Fix R1/R2 relayer + C1 copy retry + dedupe exit SELL | `relayer-client.ts`, `copy-processor.ts`, `copy-exit-pipeline.ts` |
| [applied/2026-08-07_PLAN_audit-crypto-algo.md](applied/2026-08-07_PLAN_audit-crypto-algo.md) | Audit crypto-algo complet (C1–C3, S1–S6, F1–F5) 100% implémenté | `strategy-runner.ts`, `naive-momentum.strategy.ts`, `monitor.ts`, `market-surveillance-recorder.ts`, `position-context-cache.ts` |
| [../weather/plans/2026-08-08_IMPL-weather-market-data-persistence.md](../weather/plans/2026-08-08_IMPL-weather-market-data-persistence.md) | Persistance snapshots/ticks/eval/forecast history + onglet Données / purge | `weather-algo-data.service.ts`, recorders, `WeatherAlgoDataTab.tsx`, migration `0100` |
| [../weather/plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md](../weather/plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md) | Patch audit backtest weather (B1–B9, F1–F6) → `engineVersion` 0.2.0 + follow-up R1–R3 (§7) | `exit-manager.ts`, `weather-adapter.ts`, `market-active.ts`, `WeatherAlgoBacktestTab.tsx` |
| [../weather/plans/2026-08-13_PLAN-purge-dead-code-weather-algo.md](../weather/plans/2026-08-13_PLAN-purge-dead-code-weather-algo.md) | Partie 2 : purge dead code D1–D11 (8 suppressions + inline + D11 scopé ; D7/D12/D13 conservés) | `WeatherCityGroup.tsx` (suppr), `weather-grouping.ts` (suppr), `api.ts`, `clocked-weather-strategy.ts`, `backtest/src/index.ts`, `context-builder.ts`, `events.ts`, `question-builder.ts`, `strategy-catalog.ts`, `weather-algo-markets.ts`, `weather-auto-track.service.ts`, `auto-track-janitor.ts` (suppr), `index.ts` |
| [../weather/plans/2026-08-13_PLAN-refactor-weather-algo-r1-r10.md](../weather/plans/2026-08-13_PLAN-refactor-weather-algo-r1-r10.md) | Partie 4 : refactors R1–R10 (R4 déjà fait via C2) — agrégateur timeline, split DataTab/BacktestTab, `EXIT_REASON_LABEL` typeorm-free, helpers routes, watched-table, formatters, `FIDELITY_OPTIONS`, split `evaluateExits` | `weather-algo-data.service.ts`, `weather-market-discovery.ts`, `query-params.ts`, `backtest-exit-reasons.ts`, `weather-adapter.ts`, `format.ts`, `fidelity-options.ts`, `Pagination.tsx`, `WeatherWatchedTable.tsx`, `WeatherAlgoDataTab.tsx`, `WeatherAlgoBacktestTab.tsx`, `vite.config.ts` |
| [../weather/plans/2026-08-13_PLAN-fix-doc-vs-code-weather-algo.md](../weather/plans/2026-08-13_PLAN-fix-doc-vs-code-weather-algo.md) | Partie 5 : fix Doc vs code F1–F8 (routes manquantes, `fidelityMinutes`, warning `kill_switch_partial_close`, retrait janitor auto-track, wording « 6 tables ») | `api.md`, `backtest.md`, `weather-algo.md`, `code/08-weather-algo.md`, `plans/applied/2026-08-08_IMPL-...`, `plans/2026-08-08_PLAN-...` |
| [../weather/plans/2026-08-13_PLAN-fix-c7-c10-c11-c12-weather-algo.md](../weather/plans/2026-08-13_PLAN-fix-c7-c10-c11-c12-weather-algo.md) | Fix C7 (proxyFallback), C10 (asymétrie CDF), C11 (tolérance bucket), C12 (clé unique metric) | `resolution.ts`, `forecast-distribution.ts`, `weather-exit-helpers.ts`, `WeatherClobPriceHistory.ts`, `weather-history-ingest.service.ts`, migration `AddMetricToClobHistoryUniqueKey1700000000110` |
| [applied/2026-08-18_PLAN-fix-weather-backtest-audit.md](applied/2026-08-18_PLAN-fix-weather-backtest-audit.md) | Audit weather backtest fidélité/correctude (11 findings) → `engineVersion` 0.3.0 : fallback résolution minuit lendemain, params sortie par-stratégie, `entryMean` replay, carry-forward `markPrice`, résolution forcée ghost positions (`BACKTEST_INCOMPLETE_DATA`), garde `isHighestYes` drift/bucket, cleanup `proxyFallback` | `weather-adapter.ts`, `exit-manager.ts`, `events.ts`, `data-loader.ts`, `resolution.ts`, `backtest-exit-reasons.ts`, `engine-version.ts`, `backtest.md` |
| [applied/2026-08-23_PLAN-perf-ridge-plot-downsampling.md](applied/2026-08-23_PLAN-perf-ridge-plot-downsampling.md) | Ridge plot : downsampling min-max dans `buildPath` | `ridge/scale.ts` |
| [applied/2026-08-23_PLAN-perf-ridge-plot-precompute.md](applied/2026-08-23_PLAN-perf-ridge-plot-precompute.md) | Ridge plot : pré-calcul / cache par série | `packages/frontend/src/components/backtest/ridge/` |
| [applied/2026-08-23_PLAN-perf-ridge-plot-projection-player.md](applied/2026-08-23_PLAN-perf-ridge-plot-projection-player.md) | Ridge plot : projection player | `packages/frontend/src/components/backtest/ridge/` |
| [applied/2026-08-23_PLAN-fix-weather-backtest-audit-complet.md](applied/2026-08-23_PLAN-fix-weather-backtest-audit-complet.md) | Audit weather backtest complet → `engineVersion` 0.6.0 (transparence marks stale, userId lock, cursor SQL) | `weather-adapter.ts`, `backtest.ts`, docs backtest |
| [applied/2026-08-24_PLAN-fix-backtest-fixed-shares-sizing.md](applied/2026-08-24_PLAN-fix-backtest-fixed-shares-sizing.md) | Honor `fixed_shares` dans le fill-engine backtest | `weather-adapter.ts`, fill-engine |
| [applied/2026-08-24_PLAN-fix-backtest-sizing-warning.md](applied/2026-08-24_PLAN-fix-backtest-sizing-warning.md) | Warning `risk_sizing_mode_ignored` pour modes non supportés | `adapter-warnings.ts` |
| [applied/2026-08-24_PLAN-fix-backtest-min-yes-price.md](applied/2026-08-24_PLAN-fix-backtest-min-yes-price.md) | Filtre min YES price backtest | `weather-adapter.ts` |
| [applied/2026-08-24_PLAN-frontend-dedup-snapshots-sim-real.md](applied/2026-08-24_PLAN-frontend-dedup-snapshots-sim-real.md) | Mutualiser snapshots sim/real (`SnapshotsPanel` / `useSnapshots`) | `SnapshotsPanel.tsx`, `useSnapshots.ts` |
| [applied/2026-08-24_PLAN-frontend-split-snapshot-config-diff.md](applied/2026-08-24_PLAN-frontend-split-snapshot-config-diff.md) | Extraire `SnapshotConfigDiffPanel` | `SnapshotConfigDiffPanel.tsx` |
| [applied/2026-08-24_PLAN-frontend-refactor-UpDownPriceChart.md](applied/2026-08-24_PLAN-frontend-refactor-UpDownPriceChart.md) | Refactor `UpDownPriceChart` | `UpDownPriceChart.tsx` |
| [../weather/plans/2026-08-10_PLAN-weather-clob-history-intervals.md](../weather/plans/2026-08-10_PLAN-weather-clob-history-intervals.md) | Multi-intervalles historique CLOB + refonte colonne « En base » | migration `AddClobHistoryIntervalToUniqueKey1700000000104`, `deleteCityInterval`, `DELETE /interval`, filtre timeline `fidelityMinutes`, `WeatherClobPriceHistory.ts` |

---

## Plans actifs (racine `docs/plans/`)

### Partiellement implémentés

| Fichier | Résumé | Écart principal |
|---------|--------|-----------------|
| [2026-08-05_PLAN-strategies-crypto-algo-5min.md](2026-08-05_PLAN-strategies-crypto-algo-5min.md) | Stop-bleed + multi-stratégies + RTDS + backtest | Phases 0–2 OK ; Phase 3 RTDS reportée, Phase 4/5 ouvertes |
| [POLYMARKET_PROTOCOL_VERIFICATION_PLAN.md](POLYMARKET_PROTOCOL_VERIFICATION_PLAN.md) | Checklist conformité protocole Polymarket | Pipelines vérifiés ; tests intégration live et items « à vérifier » ouverts |
| [../weather/plans/2026-08-08_PLAN-weather-market-data-persistence.md](../weather/plans/2026-08-08_PLAN-weather-market-data-persistence.md) | Persistance données weather (v4) | Phases 0–4 + UI Données **OK** ; Phase 5 backtest **OK** (voir `backtest.md` + patch 0.2.0) ; warnings quantitatifs §12.2 non livrés |

### Non implémentés

| Fichier | Résumé | Écart principal |
|---------|--------|-----------------|
| [2026-08-05_PLAN-backtest-engine-universel.md](2026-08-05_PLAN-backtest-engine-universel.md) | Moteur backtest universel event-driven | **Weather v1 livré** (`packages/backtest`, UI, API) ; crypto/copy, Socket.IO, Prometheus hors scope |
| [2026-08-06_PLAN-phase3-data-stream-rtds.md](2026-08-06_PLAN-phase3-data-stream-rtds.md) | Phase 3 RTDS/oracle data stream | **Désimplémenté / reporté 2026-08-07** — spec conservée, aucun code en repo |

---

## Référence (`reference/`)

| Fichier | Type | Résumé |
|---------|------|--------|
| [reference/2026-07-09_SPEC_STRATEGIE_BUILDER.md](reference/2026-07-09_SPEC_STRATEGIE_BUILDER.md) | spec | Spec produit Strategy Builder (DSL VM, UI rails) — aucune impl |
| [reference/ANALYSIS_CRYPTO_ALGO_SHORT_TERM_MARKETS.md](reference/ANALYSIS_CRYPTO_ALGO_SHORT_TERM_MARKETS.md) | analysis | Analyse architecture/gaps crypto-algo short-term |
| [reference/ANALYSIS_CRYPTO_ALGO_SHORT_TERM_MARKETS_V2.md](reference/ANALYSIS_CRYPTO_ALGO_SHORT_TERM_MARKETS_V2.md) | analysis | Analyse révisée post-inspection code |
| [reference/IMPLEMENTATION_PLAN_REVIEW.md](reference/IMPLEMENTATION_PLAN_REVIEW.md) | analysis | Revue critique du plan V1 → recommandations V2 |
| [reference/VERIFICATION_REPORT.md](reference/VERIFICATION_REPORT.md) | report | Rapport d'audit protocole Polymarket (2025-06-24) |
| [reference/2026-08-06_ANNEXE-risques-mitigations.md](reference/2026-08-06_ANNEXE-risques-mitigations.md) | annexe | Annexe risques R1–R9 pour l'audit global |
| [reference/riskconfig-consumer-matrix.md](reference/riskconfig-consumer-matrix.md) | matrix | Matrice consommateurs RiskConfig → configs isolées (Phase F done) |

---

## Archivés (`archived/`)

| Fichier | Raison d'archivage |
|---------|-------------------|
| [archived/IMPLEMENTATION_PLAN_CRYPTO_ALGO.md](archived/IMPLEMENTATION_PLAN_CRYPTO_ALGO.md) | Remplacé par V2 (`applied/IMPLEMENTATION_PLAN_CRYPTO_ALGO_V2.md`) |
| [archived/2026-07-04_PLAN_HARD_EXIT_CRYPTO_ALGO.md](archived/2026-07-04_PLAN_HARD_EXIT_CRYPTO_ALGO.md) | `TIME_EXIT` jamais câblé ; schema droppé ; tests skipped |
| [archived/websocket-crypto-algo-plan.md](archived/websocket-crypto-algo-plan.md) | Feed hybride livré via V2 / `price-feed.ts` ; Phase 3 observabilité non reprise |
| [archived/2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md](archived/2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md) | Tunables livrés ; maps TIME_EXIT retirées avec le feature |
| [archived/2026-07-03_PLAN_FIX_SL_TP_PRECLOSE_SIM.md](archived/2026-07-03_PLAN_FIX_SL_TP_PRECLOSE_SIM.md) | Fix 1–2 livrés (shouldSuppressSlTp, pre-close) ; Fix 3/4 obsolètes (FAK sim, bid-points, stop-bleed) |
| [2026-08-24_PLAN-frontend-reorganiser-components.md](2026-08-24_PLAN-frontend-reorganiser-components.md) | **Annulé** — migration scriptée a corrompu les imports (2026-08-24) |
| [2026-08-24_PLAN-frontend-generic-data-table-explorer.md](2026-08-24_PLAN-frontend-generic-data-table-explorer.md) | **Non factorisé** — diff préalable sous le seuil (2026-08-24) |

---

## Liens croisés

Plans parent/enfant :
- `applied/2026-08-06_PLAN-audit-global-codebase-doc-bugs-fantomes.md` ← parent de `applied/2026-08-06_PLAN-p0-implementation.md` et `reference/2026-08-06_ANNEXE-risques-mitigations.md`
- `2026-08-05_PLAN-strategies-crypto-algo-5min.md` ← dépend de `2026-08-06_PLAN-phase3-data-stream-rtds.md` (Phase 3, reportée)
