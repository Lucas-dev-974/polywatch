# PLAN — Audit global codebase : alignement doc, structure, conflits, bugs fantômes

> **Date de création** : 2026-08-06
> **Périmètre** : Monorepo Polywatch-v1.1 (7 packages + docs + tools + e2e)
> **Règle d'or** : Ce plan est **vivant**. À chaque étape terminée, mettre à jour ce fichier (statut, dates, observations, écarts détectés). Toute modification de code ou de doc effectuée pendant l'audit doit être reflétée ici.

---

## 0. Règle de mise à jour du plan (OBLIGATOIRE)

**Chaque étape complétée doit déclencher une mise à jour de ce fichier** :

1. Remplacer `[ ]` par `[x]` dans la todolist de l'étape.
2. Renseigner la date de complétion (`✅ 2026-XX-XX`).
3. Ajouter une ligne **"Observations"** sous l'étape avec :
   - ce qui a été vérifié/corrigé
   - tout écart détecté non prévu
   - tout report vers une autre étape
4. Si une étape révèle du travail supplémentaire, ajouter de nouvelles sous-étapes `[ ]` dans la section concernée.
5. Mettre à jour la section **"Statut global"** en haut du fichier.

### Statut global

| Phase | Statut | Dernière mise à jour |
|-------|--------|----------------------|
| Phase 1 — Cartographie initiale | ✅ Terminée | 2026-08-06 |
| Phase 1b — Vérification des constats (C1-C17) | ✅ Terminée | 2026-08-06 |
| Phase 1c — Analyse des risques & mitigations | ✅ Terminée | 2026-08-06 |
| Phase 1d — Plan d'implémentation P0 | ✅ Terminée (A–E mergés PR #1 ; F reportée) | 2026-08-06 |
| Phase 2 — Audit doc↔code (par module) | ⏳ En cours | — |
| Phase 3 — Audit structurel & refactor | ⏳ En cours | — |
| Phase 4 — Audit bugs fantômes | ⏳ En cours | — |
| Phase 5 — Synthèse & corrections | ⏳ En attente | — |

---

## 1. Contexte de la codebase (résumé de la cartographie)

Polywatch est un monorepo npm workspaces (7 packages) de copy-trading sur Polymarket, double mode (simulation/réel), avec trading algorithmique crypto et météo.

### 1.1 Topologie des packages

| Package | Rôle | Fichiers src | Lignes approx |
|---------|------|--------------|----------------|
| `core` | Logique métier partagée (entités, services, risk, sizing, sim, polymarket) | 657 | ~36k |
| `backend` | API Express + Socket.IO + JWT + flux wallet | ~120 | ~10k |
| `worker` | Exécution CLOB/sim, SL/TP, janitors | ~80 | ~12k |
| `copy-trading` | Détection moves traders → `order-signals` | ~40 | ~4k |
| `crypto-algo` | Trading algo crypto (stratégies, price feed, surveillance) | 35 | ~5.7k |
| `weather-algo` | Trading algo météo city-first | 18 | ~3k |
| `frontend` | UI SolidJS (Vite, port 5173) | 552 | ~30k |

### 1.2 Documentation technique principale

**12 fichiers racine** (`docs/*.md`) + **9 fichiers** `docs/code/*.md` + ~80 fichiers d'historique (audits/plans/patchs/v1).

### 1.3 Constats structurels majeurs (de la cartographie)

Ces constats guident les étapes d'audit ci-dessous. **Source : [Explore core structure](cbf99968-f242-4b27-860d-659d11934561), [Explore crypto-algo](418cf19d-6d28-4f20-9d26-10e83b4dedd5), [Explore frontend/backend/worker](3a9c69cf-4d27-4431-87d7-3cecf61f166f), [Explore docs](2d9a7f76-fdf1-49f4-928d-57e51b59686e)**.

| # | Constat | Sévérité | Modules concernés |
|---|---------|----------|-------------------|
| C1 | **Duplication massive sim/real** (~10 paires de fichiers quasi-identiques : archive, snapshot, rollup, lock, session, types) | 🔴 Élevée | `core/simulation/` ↔ `core/real/`, `core/services/sim-*` ↔ `core/services/real-*`, `core/types/sim-*` ↔ `core/types/real-*` |
| C2 | **Quartet de services de config dupliqués** (`Global/Copy/Crypto/WeatherConfigService` structurellement identiques) | 🟡 Moyenne | `core/services/*-config.service.ts` |
| C3 | **Fonctions utilitaires dupliquées** (`toIso` ×6, `traderDisplayLabel` ×3, `rollupKey` ×3, `isPostgres` ×2) | 🟡 Moyenne | `core/services/`, `core/simulation/`, `core/real/` |
| C4 | **`RiskConfig` legacy en transition non terminée** (table monolithique 592 lignes marquée "TODO remove after 0088" mais toujours exportée/utilisée ; coexiste avec `GlobalConfig`/`CopyConfig`/`CryptoConfig`/`WeatherConfig`) | 🔴 Élevée | `core/entities/RiskConfig.ts`, `core/risk/policy.ts`, `core/services/risk.service.ts` |
| C5 | **3 utilitaires Polymarket dupliqués dans 3 packages** (`circuit-breaker`, `rate-limited-fetch`, `token-bucket` quasi-identiques ; `api-client` NON identique : core=minimal 47 lignes, worker/copy-trading=riche 68-130 lignes) | 🟡 Moyenne | `core/polymarket/`, `worker/polymarket/`, `copy-trading/polymarket/` |
| C6 | **God-objects** : `crypto-algo/index.ts` (519 lignes wiring), `crypto-algo/strategy/strategy-runner.ts` (856 lignes), `frontend/UpDownPriceChart.tsx` (1219 lignes), `backend/routes/simulation.ts` (691 lignes), `core/risk/policy.ts` (659 lignes), `core/entities/RiskConfig.ts` (592 lignes) | 🟡 Moyenne | voir colonne modules |
| C7 | **Frontière floue `core/market/` vs `core/polymarket/`** : `polymarket/market-list.ts:8` réexporte `marketClassifier` et contient `isMarketActive` (`:47`, logique métier) ; `isMarketNotExpired`/`isMarketUpcoming` sont dans `auto-track-discovery.ts:147,168` | 🟢 Mineure | `core/market/`, `core/polymarket/` |
| C8 | **Duplication `crypto-algo` ↔ `weather-algo`** : `strategy-runner.ts`, `*-entry-pipeline.ts`, `*-exit-evaluator.ts`, `auto-track-janitor.ts`, `runtime-status.ts`, `watchlist-seed.ts`, `constants.ts` quasi-identiques | 🟡 Moyenne | `crypto-algo/src/`, `weather-algo/src/` |
| C9 | **Code mort / dépréciations non purgées** dans crypto-algo : `buildMarkdownReport` (monitor.ts:642, jamais appelé), `MAX_ENTRIES_PER_WINDOW` (strategy-runner.ts:64, 0 consommateur), `loadSlQuotaCount`/`isSlQuotaReached` (sl-quota.ts:85/114, 0 consommateur), `SPREAD_BY_INTERVAL`/`getMaxSpreadForInterval` (constants.ts:40/85, remplacé par `getMaxSpreadAbsForInterval`). ⚠️ `RE_ENTRY_WINDOW_MS` + TTL constants = `@deprecated` mais **actifs en fallback** (strategy-runner.ts:152,439,948). NB : `GAMMA_STALE_ON_ERROR_TTL_FACTOR`/`gammaCacheTtlFallback` ne sont **pas** marqués `@deprecated` (plan initial inexact). 6 exports deprecated (pas 5) | 🟢 Mineure | `crypto-algo/` |
| C10 | **`post-entry-mid-logger.ts` feature inachevée** : timers +1s/+5s/+30s mesurent adverse selection mais `PostEntryMidSample` jamais persistés | 🟡 Moyenne | `crypto-algo/src/post-entry-mid-logger.ts` |
| C11 | **`docs/code/README.md` stale** : titre "v0.1.0", date 2026-07-22, weather-algo non listé dans le sommaire | 🟢 Mineure | `docs/code/README.md` |
| C12 | **`docs/audit-api-alignement.md` obsolète** : daté 2026-07-06 (`:4`), `api.md` fait 295 lignes (audit cite 231). Routes backend manquantes dans `api.md` : `system-audit`, `weather-algo-executions`, `weather-algo-capital`, `config-per-kind`. NB : `market-chart` non-crypto EST documenté (`api.md:217`) — retrait de la liste manquante | 🟡 Moyenne | `docs/audit-api-alignement.md`, `docs/api.md` |
| C13 | **Lacune doc weather-algo** : pas de `docs/code/08-weather-algo.md` (seul package sans doc technique détaillée). `docs/weather-algo.md` = 67 lignes (concis) | 🟡 Moyenne | `docs/code/` |
| C14 | **Modules non documentés** : `backend/src/e2e/` (absent de `05-backend.md`), `tools/recover-stranded-redemption/` (README non référencé dans `docs/README.md`), `crypto-algo/scripts/monitor.ts` (absent de `configuration.md`). NB : `e2e/` racine EST documenté (`01-architecture.md:20` + `configuration.md:301-304`) — plan initial inexact sur ce point | 🟡 Moyenne | multiple |
| C15 | **14 migrations récentes** (0081-0094, non 13) sur weather-algo + split RiskConfig + crypto-algo strategy. `docs/code/03-core.md:36` dit "69 migrations" vs 79 fichiers réels (écart 10). Seule `SimBalancePerAlgoKind` (0084) mentionnée dans doc technique (`snapshots-simulation.md:407`) | 🟡 Moyenne | `core/migrations/` |
| C16 | **`surveillance-targets.ts`, `signal-state-registry.ts`, `position-context-cache.ts`, `algo-percent-publisher.ts`, `algo-chart-tick-publisher.ts`** non nommés dans `docs/crypto-algo.md` (0 match). `curve-descending-gate.ts` : reason documentée mais module fichier non nommé. NB : `mid-history-buffer` EST mentionné (`:51`), `auto-track-janitor` EST mentionné (`:33`) — à retirer de la liste initiale | 🟢 Mineure | `docs/crypto-algo.md` |
| C17 | **`monitor.ts` (672 lignes)** : 3 requêtes SQL interpolent `${hours}` (`:84`, `:135`, `:172`), `hours = Math.max(1, Number(env))` sans garde NaN. Source = env var (pas HTTP) → risque actuel proche de zéro. NB : `conditionId` n'est **jamais interpolé** (plan initial inexact). Sévérité reclassée 🟢 Mineure (était 🟡) | 🟢 Mineure | `crypto-algo/src/scripts/monitor.ts` |

---

## 1b. Vérification des constats (C1-C17) — 2026-08-06

> Vérification par lecture du code réel. Sources : [Verify core claims](a411d433-b2d3-40f5-a452-72290b14f53d), [Verify crypto-algo claims](b27581c0-b8fa-421e-a757-aff9ebc58ddf), [Verify documentation claims](4d01f137-7348-4c4b-940b-b9eb937ab109).

### Résultats de vérification

| Constat | Statut | Correction appliquée au plan |
|---------|--------|-------------------------------|
| C1 | ✅ Confirmé | — |
| C2 | ✅ Confirmé | — |
| C3 | ✅ Confirmé | — |
| C4 | ✅ Confirmé | — |
| C5 | ⚠️ Corrigé | `api-client` retiré des "dupliqués" (core=minimal, worker/copy-trading=riche) |
| C6 | ✅ Confirmé | — |
| C7 | ⚠️ Corrigé | `isMarketNotExpired`/`isMarketUpcoming` sont dans `auto-track-discovery.ts`, pas `market-list.ts` |
| C8 | ✅ Confirmé | — |
| C9 | ⚠️ Corrigé | `GAMMA_STALE_ON_ERROR_TTL_FACTOR`/`gammaCacheTtlFallback` ne sont PAS deprecated (plan inexact) ; 6 exports deprecated (pas 5) ; `RE_ENTRY_WINDOW_MS` + TTL actifs en fallback |
| C10 | ✅ Confirmé | — |
| C11 | ✅ Confirmé | — |
| C12 | ⚠️ Corrigé | `api.md` = 295 lignes (pas 231) ; `market-chart` EST documenté (`api.md:217`) — retiré des routes manquantes |
| C13 | ⚠️ Corrigé | `docs/weather-algo.md` = 67 lignes (pas 89) |
| C14 | ⚠️ Corrigé | `e2e/` racine EST documenté (`01-architecture.md:20` + `configuration.md:301-304`) — sous-affirmation "non documenté" réfutée |
| C15 | ⚠️ Corrigé | 14 migrations (pas 13) ; `03-core.md:36` dit "69" vs 79 réels |
| C16 | ⚠️ Corrigé | `mid-history-buffer` (`:51`) et `auto-track-janitor` (`:33`) SONT mentionnés — retirés de la liste |
| C17 | ⚠️ Corrigé | `conditionId` jamais interpolé (plan inexact) ; sévérité reclassée 🟢 Mineure (risque actuel proche de zéro, source = env var) |

### Décisions utilisateur prises (2026-08-06)

| # | Décision | Impact |
|---|---------|--------|
| C4 | **Terminer la transition** — purger `RiskConfig.ts`, getters legacy `risk/policy.ts`, `risk/risk-config-api.ts`, `risk/sim-mode-fields.ts` et migrer les ~15 consommateurs vers les 4 tables isolées | 🔴 P0 — chantier majeur, à planifier en étape dédiée (Phase 3.5) |
| C5 | **Centraliser les 3 utilitaires identiques** (`circuit-breaker`, `token-bucket`, `rate-limited-fetch`) dans `core/polymarket/` et réexporter ; **laisser `api-client` spécifique** à chaque package | 🟡 P2 — refactor structurel |
| C10 | **Terminer la feature post-entry-mid-logger** — persister `PostEntryMidSample` en DB, brancher `onSample` dans `index.ts`, nettoyer les timers à la fermeture individuelle de position | 🟡 P1 — feature inachevée à compléter |
| C9 | **Purger les constantes deprecated** — remplacer `RE_ENTRY_WINDOW_MS`, `MAX_ENTRIES_PER_WINDOW`, TTL constants par les resolvers core (`resolveCryptoAlgoReentryParams`, `resolveGammaCacheTtlMs`), supprimer le fallback local | 🟢 P3 — nettoyage |

---

## 2. Méthodologie d'audit (compétences utilisées)

L'audit suit le skill **audit-codebase-docs** (double passage Doc→Code puis Code→Doc) pour chaque module, et le skill **verify-implementation** pour la chasse aux bugs fantômes sur les zones à risque.

- **Étape 0** : Mise en contexte (rôle Expert Auditeur + règles d'or : zéro supposition, preuves systématiques `fichier.ts:ligne X`, rigueur terminologique).
- **Étape 1** : Passage Doc→Code (la promesse) — vérifier que tout ce qui est écrit est vrai.
- **Étape 2** : Passage Code→Doc (l'exhaustivité) — vérifier que tout ce qui est codé est expliqué.
- **Étape 3** : Synthèse + plan d'action priorisé (🔴/🟡/🟢).
- **Bugs fantômes** : regime perturbé (panne externe, shutdown, charge, reconnexion), erreurs avalées, états incohérents, fuites, races.

---

## 3. Todolist détaillée par phase

### Phase 2 — Audit doc↔code (par module)

> Pour chaque module : double passage (Doc→Code, Code→Doc), tableau de confrontation, lacunes, divergences.

#### 2.1 — `@polywatch/core` : entités + modèle de données

- [ ] Vérifier `docs/modele-donnees.md` contre `core/entities/*.ts` (47 entités documentées vs réelles)
- [ ] Vérifier `docs/code/03-core.md` § entités contre `core/entities/index.ts` (barrel exports)
- [ ] Confirmer statut `RiskConfig.ts` legacy (C4) : `entities/index.ts` ligne 3 indique "TODO remove after 0088" — vérifier que la migration `0088` est jouée et que `RiskConfig` est encore importé/utilisé
- [ ] Vérifier que les 4 nouvelles entités config (`GlobalConfig`, `CopyConfig`, `CryptoConfig`, `WeatherConfig`) sont documentées dans `modele-donnees.md`
- [ ] Vérifier la cohérence `data-source.ts` (356 lignes) : entités enregistrées vs `entities/index.ts` exports
- [ ] **Observations** :
  - *(à remplir après exécution)*

#### 2.2 — `@polywatch/core` : services (67 fichiers, 13k lignes)

- [ ] Vérifier `docs/code/03-core.md` § services : 41 services documentés vs 67 fichiers réels
- [ ] Identifier les 26 services non documentés (dont `global-config.service.ts`, `copy-config.service.ts`, `crypto-config.service.ts`, `weather-config.service.ts`, `market-position-tick.service.ts`, `market-price-tick.service.ts`, `market-price-history-backfill.service.ts`, `real-archive.service.ts`, `real-period-archive.service.ts`, `real-session.service.ts`, `real-portfolio.service.ts`, `poll-cycle.service.ts`, `copied-position.service.ts`, `algo-surveillance-positions.ts`, `algo-surveillance.resolvers.ts`, `market.service.ts`, `market-sync-config.service.ts`)
- [ ] Vérifier la description du quartet de config dupliqué (C2) — la doc mentionne-t-elle le pattern `BaseConfigService<T>` manquant ?
- [ ] **Observations** :

#### 2.3 — `@polywatch/core` : risk + sizing + pricing + positions

- [ ] Vérifier `docs/code/03-core.md` § risk contre `core/risk/` (25 fichiers)
- [ ] Vérifier `docs/configuration.md` § RiskConfig (params sim/real/crypto/weather) contre `core/risk/policy.ts` (659 lignes) + `core/risk/crypto-algo-tunables.ts` (637 lignes)
- [ ] Vérifier `docs/crypto-algo.md` § tunables contre `core/risk/crypto-algo-tunables.ts` + `crypto-algo-strategy-params.ts` (nouveau)
- [ ] Vérifier que `docs/weather-algo.md` mentionne `core/risk/weather-exit-params.ts` + `core/risk/weather-config-api.ts`
- [ ] Vérifier sizing (`core/sizing/`, 23 fichiers) — doc mentionne `compute.ts`, `entry-sizing.ts`, `entry-mos.ts`, `resolve-entry-mos.ts` ?
- [ ] **Observations** :

#### 2.4 — `@polywatch/core` : simulation + real (miroir)

- [ ] Vérifier `docs/snapshots-simulation.md` contre `core/simulation/` (21 fichiers) + `core/services/simulation-*.ts`
- [ ] Vérifier `docs/snapshots-real.md` contre `core/real/` (3 fichiers) + `core/services/real-*.ts`
- [ ] Documenter explicitement la duplication sim/real (C1) — la doc mentionne-t-elle ce miroir ?
- [ ] Vérifier `docs/simulation-execution.md` contre `core/risk/sim-execution-tunables.ts` + `core/simulation/accounting.ts`
- [ ] **Observations** :

#### 2.5 — `@polywatch/core` : migrations (79 fichiers)

- [ ] Vérifier `docs/code/03-core.md` mentionne "69 migrations" vs 79 fichiers réels (C15)
- [ ] Créer un inventaire des migrations 0081-0094 (récentes) et vérifier leur mention dans la doc
- [ ] Vérifier `docs/configuration.md` (bande d'entrée, curve filter, SL quota) référence les bonnes migrations
- [ ] **Observations** :

#### 2.6 — `@polywatch/core` : polymarket + market + redis

- [ ] Vérifier `docs/code/03-core.md` § polymarket contre `core/polymarket/` (41 fichiers)
- [ ] Vérifier la frontière `market/` vs `polymarket/` (C7) — la doc distingue-t-elle classification métier vs intégration API ?
- [ ] Vérifier `core/redis/` (13 fichiers, throttles, pub/sub) — doc mentionne `sim-reset-redis-hygiene.ts` (470 lignes) ? `crypto-reentry-throttle.ts` ? `weather-bucket-hysteresis.ts` ?
- [ ] **Observations** :

#### 2.7 — `@polywatch/crypto-algo`

- [ ] Vérifier `docs/crypto-algo.md` + `docs/code/07-crypto-algo.md` contre `packages/crypto-algo/src/` (35 fichiers)
- [ ] Compléter la doc pour les modules non nommés (C16) : `surveillance-targets.ts`, `signal-state-registry.ts`, `position-context-cache.ts`, `algo-percent-publisher.ts`, `algo-chart-tick-publisher.ts`, `curve-descending-gate.ts`, `mid-history-buffer.ts`, `post-entry-mid-logger.ts` (C10), `auto-track-janitor.ts`, `monitor.ts`
- [ ] Vérifier la description du pipeline `price tick → signal → entry` (flux critique) contre `strategy-runner.ts` + `algo-entry-pipeline.ts`
- [ ] Vérifier la description des codes d'abstention (14 codes `AbstainReasonCode`) contre `strategy/strategy.ts`
- [ ] Vérifier la topologie des janitors/timers dans `index.ts` (6 timers) — la doc la décrit-elle ?
- [ ] Vérifier que `core/crypto-algo/` (optimize-report, fingerprint) est bien documenté comme couche analytique orthogonale
- [ ] **Observations** :

#### 2.8 — `@polywatch/backend`

- [ ] Vérifier `docs/api.md` + `docs/code/05-backend.md` contre `backend/src/routes/` (routes récentes C12)
- [ ] Vérifier `docs/metrics.md` contre `backend/src/metrics.ts` (état juillet)
- [ ] Auditer les routes non documentées : `system-audit.ts`, `crypto-algo-monitor.ts`, `weather-algo-executions.ts`, `weather-algo-capital.ts`, `config-per-kind.ts`, `market-chart.ts`
- [ ] Vérifier le module `backend/src/e2e/` (C14) — non documenté
- [ ] Recenser les routes internes `/api/internal/*` (credentials, balances, pnl-ticks, alerts, move-detected, circuit-breaker, queues) contre `routes/internal/`
- [ ] **Observations** :

#### 2.9 — `@polywatch/worker`

- [ ] Vérifier `docs/code/04-worker.md` + `docs/simulation-execution.md` contre `worker/src/` (~80 fichiers)
- [ ] Vérifier les processors (`executor.ts` 606 lignes, `strategy-processing.ts`, `results-consumer.ts`) contre la doc
- [ ] Vérifier la description des janitors (MarketResolutionWatcher, RedemptionHandler, ClosingWatchdog, PlacingJanitor, ReservationJanitor, PendingEntryJanitor, SimRealismJanitor) contre le code
- [ ] Vérifier la duplication `polymarket/` dans worker (C5) — la doc mentionne-t-elle ces copies ?
- [ ] **Observations** :

#### 2.10 — `@polywatch/copy-trading`

- [ ] Vérifier `docs/pipeline-copy-trading.md` + `docs/code/05-copy-trading.md` contre `copy-trading/src/`
- [ ] Vérifier les pipelines entry/exit, MoveDetector, CopyProcessor
- [ ] Vérifier la duplication `polymarket/` dans copy-trading (C5)
- [ ] **Observations** :

#### 2.11 — `@polywatch/weather-algo` (lacune doc)

- [ ] **Créer** `docs/code/08-weather-algo.md` (C13) — arborescence, fichiers, resilience patterns, shutdown
- [ ] Vérifier `docs/weather-algo.md` contre `weather-algo/src/` (18 fichiers)
- [ ] Vérifier la duplication `crypto-algo` ↔ `weather-algo` (C8) — la doc mentionne-t-elle ce pattern partagé ?
- [ ] Vérifier `docs/architecture.md` § Weather-Algo contre `weather-algo/src/index.ts`
- [ ] **Observations** :

#### 2.12 — `@polywatch/frontend`

- [ ] Vérifier `docs/frontend.md` + `docs/code/06-frontend.md` contre `frontend/src/` (552 fichiers)
- [ ] Vérifier les nouveaux composants weather (12 composants, 04-05/08) et crypto-algo settings (06/08)
- [ ] Vérifier `UpDownPriceChart.tsx` (1219 lignes) — la doc mentionne-t-elle ce composant massif ?
- [ ] Vérifier `api.ts` (710 lignes) — tous les endpoints REST sont-ils documentés ?
- [ ] **Observations** :

#### 2.13 — `tools/`, `e2e/`, `scripts/`

- [ ] Vérifier `docs/configuration.md` §8 (scripts) contre `tools/` (37 scripts) — identifier les manquants (C14)
- [ ] Documenter `tools/recover-stranded-redemption/` (README non référencé)
- [ ] Documenter `e2e/` (organisation, helpers, suites)
- [ ] Vérifier `crypto-algo/src/scripts/monitor.ts` (C17 — risque injection SQL)
- [ ] **Observations** :

#### 2.14 — Audits/plans/patchs (historique)

- [ ] Vérifier que `docs/README.md` référence les audits/patchs récents (août)
- [ ] Vérifier `docs/code/README.md` (C11 — stale "v0.1.0")
- [ ] Identifier les audits dont les conclusions ont été appliquées (marquer comme "appliqué")
- [ ] **Observations** :

---

### Phase 3 — Audit structurel & refactor

> Identifier les fichiers massifs, les responsabilités multiples, les découpages nécessaires, la cohérence.

#### 3.1 — Duplication sim/real (C1)

- [ ] Mesurer l'identité entre `simulation/trader-rollup.ts` ↔ `real/trader-rollup.ts` (diff réel)
- [ ] Mesurer l'identité entre `simulation/snapshot-decision-collector.ts` ↔ `real/snapshot-decision-collector.ts`
- [ ] Mesurer l'identité entre `services/simulation-archive.service.ts` ↔ `services/real-archive.service.ts`
- [ ] Mesurer l'identité entre `services/simulation-session.service.ts` ↔ `services/real-session.service.ts`
- [ ] Évaluer la faisabilité d'une généralisation `ModeSession<Snap,Archive>` (type générique paramétré par mode)
- [ ] **Observations** :

#### 3.2 — Quartet de services de config (C2)

- [ ] Comparer `global-config.service.ts`, `copy-config.service.ts`, `crypto-config.service.ts`, `weather-config.service.ts` (diff structurel)
- [ ] Évaluer l'extraction d'une classe `BaseConfigService<T extends object>` dans `core/services/`
- [ ] **Observations** :

#### 3.3 — Utilitaires dupliqués (C3, C5)

- [ ] Recenser toutes les copies de `toIso`, `traderDisplayLabel`, `rollupKey`, `isPostgres` et centraliser dans `core/lib/`
- [ ] Recenser les copies de `circuit-breaker.ts`, `rate-limited-fetch.ts`, `token-bucket.ts`, `api-client.ts` (3 packages) et centraliser dans `core/polymarket/`
- [ ] **Observations** :

#### 3.4 — God-objects (C6)

- [ ] `crypto-algo/index.ts` (519 lignes) — évaluer l'extraction d'un `CryptoAlgoBootstrap` + sous-modules wiring
- [ ] `crypto-algo/strategy/strategy-runner.ts` (856 lignes) — évaluer l'extraction du cache Gamma, du re-entry throttle, du SL quota en sous-modules
- [ ] `frontend/UpDownPriceChart.tsx` (1219 lignes) — évaluer l'extraction de la logique de rendu vs canvas
- [ ] `backend/routes/simulation.ts` (691 lignes) — évaluer le split par endpoint
- [ ] `core/risk/policy.ts` (659 lignes) — évaluer le split legacy vs wrappers algo-kind
- [ ] **Observations** :

#### 3.5 — RiskConfig legacy (C4)

- [ ] Confirmer que la migration `0088` (`DropLegacyRiskConfig`) est bien jouée en base
- [ ] Identifier tous les imports de `RiskConfig` encore actifs dans le code
- [ ] Vérifier que `risk/policy.ts` + `services/risk.service.ts` ne lisent plus `RiskConfig` en production
- [ ] Planifier la suppression finale de `entities/RiskConfig.ts` + `risk/risk-config-api.ts` + `risk/sim-mode-fields.ts` si plus consommateurs
- [ ] **Observations** :

#### 3.6 — Code mort / dépréciations (C9)

- [ ] Vérifier consommateurs de `buildMarkdownReport` (monitor.ts) — code mort confirmé ?
- [ ] Vérifier consommateurs de `gammaCacheTtlFallback` + constantes TTL locales (strategy-runner.ts)
- [ ] Vérifier consommateurs des 5 exports `@deprecated` (sl-quota, constants, strategy-runner)
- [ ] Planifier la purge si confirmé
- [ ] **Observations** :

#### 3.7 — Duplication crypto-algo ↔ weather-algo (C8)

- [ ] Comparer `crypto-algo/strategy/strategy-runner.ts` ↔ `weather-algo/strategy/strategy-runner.ts`
- [ ] Comparer `crypto-algo/processors/algo-entry-pipeline.ts` ↔ `weather-algo/processors/weather-entry-pipeline.ts`
- [ ] Évaluer l'extraction d'une base `AlgoStrategyRunner` dans `core/`
- [ ] **Observations** :

#### 3.8 — `post-entry-mid-logger.ts` feature inachevée (C10)

- [ ] Vérifier si `PostEntryMidSample` est persisté quelque part (grep)
- [ ] Vérifier si `onSample` callback est branché dans `index.ts`
- [ ] Décider : terminer la feature (persistance) ou supprimer le code mort
- [ ] **Observations** :

---

### Phase 4 — Audit bugs fantômes

> Pour chaque zone à risque : regime perturbé (panne DB/Redis/WS, shutdown, charge, reconnexion), états incohérents, races, fuites.

#### 4.1 — RiskConfig double source de vérité (C4)

- [ ] Scénario : `RiskConfig` legacy et `CryptoConfig` renvoient des valeurs différentes pour `cryptoAlgoSlBidPoints` — lequel gagne ?
- [ ] Vérifier `services/risk.service.ts` : la façade cache-t-elle l'legacy ou la nouvelle table ? Invalidation cohérente ?
- [ ] Scénario : migration 0088 jouée mais `RiskConfig` encore importé → `getConfig()` retourne null ?
- [ ] **Observations** :

#### 4.2 — Duplication sim/real (C1) — drift silencieux

- [ ] Scénario : bug corrigé dans `simulation-archive.service.ts` mais pas dans `real-archive.service.ts` (miroir) → comportement divergent sim/real
- [ ] Scénario : `snapshot-decision-collector.ts` sim et real utilisent des constantes dupliquées (`SNAPSHOT_DECISION_MAX_EVENTS`) — si l'une change et pas l'autre
- [ ] **Observations** :

#### 4.3 — `crypto-algo/index.ts` shutdown (C6)

- [ ] Scénario SIGTERM pendant une évaluation en cours : `evaluating` flag est-il reset ? Le timer re-entrance est-il bloqué ?
- [ ] Scénario SIGTERM pendant `runAlgoEntryPipeline` : réservation libérée ? Queue en cours ACK ?
- [ ] Vérifier l'ordre de shutdown (timers, Redis, DS) — une erreur dans l'un empêche-t-elle les suivants ?
- [ ] **Observations** :

#### 4.4 — `strategy-runner.ts` cache Gamma + re-entry (C6, C9)

- [ ] Scénario Redis down : `re-entry throttle` fail-closed (bloque) ou fail-open (autorise) ? Doc dit "fail-closed" — vérifier le code
- [ ] Scénario WS reconnect : `midHistoryBuffer` est-il invalidé ? Le cache Gamma stale-on-error reste-t-il trop longtemps ?
- [ ] Scénario `config-changed` pendant une évaluation : le cache `currentCryptoConfig` est-il invalidé atomiquement ?
- [ ] Scénario `gammaCacheTtlFallback` : si `cryptoConfig` absent, le fallback local diverge-t-il du `resolveGammaCacheTtlMs` core ?
- [ ] **Observations** :

#### 4.5 — `sim-reset-redis-hygiene.ts` (470 lignes, hub critique)

- [ ] Scénario reset sim pendant qu'un worker consomme `algo-order-signals` : le worker voit-il la purge ? Race condition ?
- [ ] Scénario reset sim pendant qu'un signal est en `:processing` : le `recoverOrphans` au prochain boot le réinjecte-t-il alors que la queue a été purgée ?
- [ ] Vérifier que tous les canaux pub/sub et throttles sont bien purgés (liste exhaustive)
- [ ] **Observations** :

#### 4.6 — `monitor.ts` injection SQL (C17)

- [ ] Vérifier que `env.durationHours` et `env.conditionId` sont validés (type, range) avant interpolation SQL
- [ ] Vérifier que les autres paramètres SQL (interval, mode) ne viennent jamais d'une entrée utilisateur
- [ ] **Observations** :

#### 4.7 — Queue consumers worker (shutdown)

- [ ] Scénario : consumer `order-signals` crash → `process.exit(1)` (doc confirme) mais les autres consumers sont-ils tués proprement ?
- [ ] Scénario : `execution-results` en `:processing` au crash → `recoverOrphans` au reboot réinjecte-t-il dans la bonne queue ?
- [ ] **Observations** :

#### 4.8 — Polymarket WS book (worker + crypto-algo)

- [ ] Scénario : WS Polymarket drop pendant 30s → `book-freshness.ts` marque stale, mais les évaluations continuent-elles avec un book périmé ?
- [ ] Scénario : `forceRefreshBook` REST échoue → fallback sur cache stale ou abstention ?
- [ ] **Observations** :

#### 4.9 — `post-entry-mid-logger.ts` timers (C10)

- [ ] Scénario : position fermée avant +30s → les timers +1s/+5s/+30s sont-ils annulés ou s'exécutent-ils sur une position inexistante ?
- [ ] Scénario shutdown : les timers `schedulePostEntryMidLog` sont-ils nettoyés dans `shutdown()` ?
- [ ] **Observations** :

#### 4.10 — Frontend : `UpDownPriceChart.tsx` (1219 lignes)

- [ ] Scénario : démontage du composant pendant un `requestAnimationFrame` → leak ?
- [ ] Scénario : WS disconnect → le canvas continue-t-il à redraw avec des données stale ?
- [ ] **Observations** :

---

### Phase 5 — Synthèse & corrections

- [ ] Consolider tous les tableaux de confrontation Doc→Code et Code→Doc
- [ ] Produire le rapport final classé par priorité (🔴 Critique / 🟡 Majeure / 🟢 Mineure)
- [ ] Pour chaque point, préciser si la correction impacte le **CODE** ou la **DOCUMENTATION**
- [ ] Appliquer les corrections doc (après validation utilisateur)
- [ ] Ouvrir les tickets refactor code (après validation utilisateur)
- [ ] Mettre à jour `docs/README.md` pour référencer cet audit
- [ ] **Observations** :

---

## 4. Ordre de priorité suggéré

| Priorité | Étapes | Raison |
|----------|--------|-------|
| 🔴 P0 | 2.1 (entités/RiskConfig), 4.1 (double source de vérité), 3.5 (legacy purge) | Risque de bug fantôme en production si deux sources de config divergent |
| 🔴 P0 | 4.3 (crypto-algo shutdown), 4.4 (strategy-runner races) | Risque de fuite/état corrompu au shutdown ou reconnect |
| 🟡 P1 | 2.7 (crypto-algo doc), 2.11 (weather-algo doc), 2.8 (backend routes) | Lacunes doc majeures sur modules actifs |
| 🟡 P1 | 3.1 (sim/real miroir), 4.2 (drift sim/real) | Risque de régression silencieuse à chaque correction unilatérale |
| 🟡 P1 | 4.5 (sim-reset hygiene), 4.6 (monitor SQL) | Hubs critiques + sécurité |
| 🟢 P2 | 3.2 (quartet config), 3.3 (utilitaires), 3.4 (god-objects), 3.7 (crypto/weather dup) | Refactor structurel (maintenance, pas bugs immédiats) |
| 🟢 P2 | 2.9 (worker), 2.10 (copy-trading), 2.12 (frontend), 2.13 (tools/e2e) | Vérification doc exhaustive |
| 🟢 P3 | 3.6 (code mort), 3.8 (post-entry-mid-logger), C11 (README stale), C16 (modules non nommés) | Nettoyage cosmétique |

---

## 5. Annexes

### 5.1 Cartographie détaillée des packages (source : agents d'exploration)

#### `packages/core` — 26 sous-dossiers, 657 fichiers, ~36k lignes

| Sous-dossier | Fichiers | Lignes | Fichier max (lignes) |
|--------------|----------|--------|----------------------|
| `services/` | 67 | 13 382 | `execution.service.ts` (653) |
| `risk/` | 25 | 4 802 | `policy.ts` (659) |
| `migrations/` | 79 | 4 774 | `SplitRiskConfigPerAlgoKind...0087.ts` (699) |
| `polymarket/` | 41 | 4 224 | `market-list.ts` (550) |
| `entities/` | 51 | 2 859 | `RiskConfig.ts` (592) |
| `simulation/` | 21 | 2 723 | `trader-pnl-series.test.ts` (311) |
| `sizing/` | 23 | 1 886 | `compute.test.ts` (184) |
| `weather/` | 16 | 1 820 | `weather-market-discovery.ts` (368) |
| `crypto-algo/` | 8 | 1 392 | `optimize-report.ts` (464) |
| `market/` | 11 | 1 368 | `tags.ts` (280) |
| `redis/` | 13 | 1 092 | `sim-reset-redis-hygiene.ts` (470) |
| `trader-insight/` | 6 | 1 026 | `build-trader-funding.ts` (260) |
| `types/` | 10 | 864 | `index.ts` (223) |
| `lib/` | 5 | 676 | `algo-price-tick-snapshot.ts` (230) |
| `positions/` | 9 | 669 | `redemption-wait.ts` (155) |
| `worker-shared/` | 5 | 432 | `redis-queue.ts` (152) |
| `database/` | 3 | 421 | `data-source.ts` (356) |
| `seed/` | 4 | 417 | `risk-config-backfill.test.ts` (168) |
| `pricing/` | 6 | 392 | `vwap.ts` (134) |
| `real/` | 3 | 364 | `snapshot-decision-collector.ts` (232) |
| `orders/` | 8 | 338 | `close-signal.ts` (108) |
| `config/` | 3 | 234 | `secrets.ts` (117) |
| `idempotence/` | 2 | 188 | `hash.ts` (99) |
| `queue/` | 2 | 79 | `worker-queues.ts` (43) |
| `worker/` | 2 | 47 | `move-detector-settings.ts` (26) |
| `move-events/` | 2 | 37 | `relevance.ts` (24) |

#### `packages/crypto-algo` — 35 fichiers, ~5.7k lignes

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `strategy/strategy-runner.ts` | 856 | God-class runtime (cache Gamma, re-entry, SL quota, eval loop, WS wiring) |
| `processors/algo-entry-pipeline.ts` | 640 | Pipeline entry sim/real (cooldown, SL quota, réservation, sizing, MOS, depth retry) |
| `strategy/implementations/naive-momentum.strategy.ts` | 529 | Stratégie builtin (band, spread, curve, price selection) |
| `index.ts` | 519 | God-file wiring (DataSource, Redis, SelectionLoader, Registry, Runner, Janitors) |
| `price-feed.ts` | 400 | CryptoAlgoPriceFeed (WS CLOB, cache top-of-book, debounce, mid-history) |
| `market-surveillance-recorder.ts` | 279 | MarketSurveillanceRecorder (snapshots open/close) |
| `price-tick-recorder.ts` | 244 | PriceTickRecorder (algo_price_ticks 1s) |
| `strategy/sl-quota.ts` | 194 | SL quota par marché/mode (SQL + cache + pub/sub) |
| `strategy/strategy.ts` | 142 | Types/interfaces (AlgoSignal, AbstainReasonCode, StrategyContext) |

#### `packages/frontend` — 552 fichiers, ~30k lignes

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `components/UpDownPriceChart.tsx` | 1219 | Graphique prix Up/Down (canvas lourd) |
| `api.ts` | 710 | Client REST central (JWT, refresh, tous endpoints) |
| `hooks/useSimulationSnapshots.ts` | 665 | Hook snapshots simulation |
| `hooks/useRealSnapshots.ts` | 636 | Hook snapshots réel |
| `lib/snapshot-config-diff.ts` | 627 | Diff config entre snapshots |
| `components/RealSnapshotsPanel.tsx` | 580 | Panneau snapshots réel |
| `components/SimulationSnapshotsPanel.tsx` | 576 | Panneau snapshots sim |
| `components/TraderProfilePage.tsx` | 526 | Page profil trader |
| `components/NewSessionResetDialog.tsx` | 526 | Dialogue reset session |
| `components/CryptoAlgoReportViewer.tsx` | 490 | Visualiseur rapports crypto-algo |

#### Doublons Polymarket confirmés (C5)

| Fichier | Packages | Statut |
|---------|----------|--------|
| `polymarket/circuit-breaker.ts` | core, worker, copy-trading | 3 copies |
| `polymarket/rate-limited-fetch.ts` | core, worker, copy-trading | 3 copies identiques |
| `polymarket/token-bucket.ts` | core, worker, copy-trading | 3 copies |
| `polymarket/api-client.ts` | core, worker, copy-trading | 3 copies |
| `polymarket/book-freshness.ts` | core, worker | 2 copies |
| `helpers.ts` | worker, copy-trading | 2 copies |

### 5.2 Documentation — doublons et lacunes

**Doublons intentionnels (vue synthétique vs détaillée)** :

| Module | Fichiers en doublon |
|--------|---------------------|
| Architecture | `docs/architecture.md` ↔ `docs/code/01-architecture.md` |
| Pipeline copy-trading | `docs/pipeline-copy-trading.md` ↔ `docs/code/02-pipeline-copy-trading.md` |
| Crypto-algo | `docs/crypto-algo.md` ↔ `docs/code/07-crypto-algo.md` |
| Frontend | `docs/frontend.md` ↔ `docs/code/06-frontend.md` |
| Worker | `docs/code/04-worker.md` + `docs/simulation-execution.md` + `docs/pipeline-copy-trading.md` |
| Modèle données | `docs/modele-donnees.md` ↔ `docs/code/03-core.md` |

**Lacunes de couverture doc** :

| Module non documenté | Action requise |
|---------------------|----------------|
| `packages/weather-algo` (doc technique détaillée) | Créer `docs/code/08-weather-algo.md` |
| `packages/backend/src/e2e/` | Documenter dans `docs/code/05-backend.md` |
| `e2e/` (tests Playwright + helpers) | Créer section dans `docs/` |
| `tools/recover-stranded-redemption/` | Référencer le README dans `docs/README.md` |
| `crypto-algo/src/scripts/monitor.ts` | Documenter + audit SQL |
| Routes backend récentes (system-audit, weather-algo-*, config-per-kind) | Mettre à jour `docs/api.md` |
| Migrations 0081-0094 | Inventaire dans `docs/code/03-core.md` |

### 5.3 Risques et mitigations

> **Référence annexe** : [`docs/plans/2026-08-06_ANNEXE-risques-mitigations.md`](2026-08-06_ANNEXE-risques-mitigations.md)
> **Date** : 2026-08-06 — 9 risques + 1 risque transversal identifiés et mitigés.

L'analyse des risques a couvert les 9 zones critiques du plan (C1, C4, C5, C6, C8, C9, C10, C12 + process discipline) ainsi qu'un risque transversal (absence de filet de tests). L'annexe détaillée contient pour chaque risque : le contexte précis (avec références fichier:ligne), la stratégie de mitigation adaptée à la codebase, les garde-fous concrets, le plan de rollback et le séquencement recommandé.

**Tableau récapitulatif des 9 risques** :

| # | Risque | Sévérité | Stratégie de mitigation | Réf annexe |
|---|--------|----------|-------------------------|------------|
| 1 | C4 : Purge RiskConfig legacy | 🔴 P0 | Strangler Fig + guard de divergence | §R1 |
| 2 | C1 : Refactor duplication sim/real | 🔴 P0 | Généricité par composition (fonctions pures partagées) | §R2 |
| 3 | C9 : Purge deprecated constants en fallback | 🟢 P3 | Éliminer le fallback en garantissant la config au boot | §R3 |
| 4 | C6 : Refactor god-objects | 🟡 P2 | Extraction conservatrice avec invariant d'atomicité | §R4 |
| 5 | C10 : Finish post-entry-mid-logger | 🟡 P1 | Entité + migration + cancellation par position | §R5 |
| 6 | C8 : Abstract crypto-algo ↔ weather-algo | 🟡 P2 | NE PAS abstraire — documenter et converger par copie consciente | §R6 |
| 7 | Process discipline (plan manuel) | 🟢 P3 | Automatisation légère | §R7 |
| 8 | C5 : Centralize Polymarket | 🟢 P2 | Move + re-export shim | §R8 |
| 9 | C12 : Update api.md | 🟡 P1 | Ajouter routes manquantes + script coverage CI | §R9 |
| T | Risque transversal — No test safety net | 🔴 P0 | Filet de tests ciblé avant refactor | §RT |

**Principes transversaux** (détaillés dans l'annexe § Recommandations transversales) :
- Stratégie de branching : 1 branche dédiée par chantier critique (C4, C1, C6, C10), 1 PR par branche.
- Feature flags de sécurité : `RISK_CONFIG_LEGACY_FACADE`, `RISK_CONFIG_STRICT`, `DEPRECATED_FALLBACKS_ENABLED` permettent rollback instantané.
- Ordre d'exécution global en 6 phases (A-F), du test safety net au différé.
- **Règle d'or** : aucun refactor critique ne commence avant que le test d'arête correspondant existe et soit vert.

### 5.4 Plan d'implémentation P0

> **Référence** : [`docs/plans/2026-08-06_PLAN-p0-implementation.md`](2026-08-06_PLAN-p0-implementation.md)
> **Date** : 2026-08-06 — Plan d'implémentation des priorités P0 (C4 RiskConfig, C1 sim/real, bugs fantômes 4.3/4.4 + filet de tests).
> **Statut** : ✅ **Phases A–E mergées** dans `main` via [PR #1](https://github.com/Lucas-dev-974/polywatch/pull/1) (`81571ba`). Phase F (purge physique RiskConfig) reportée — PR séparée.

Ce plan opérationnalise les mitigations de l'annexe §R1, §R2, §R4, §RT pour les 3 chantiers P0. Il contient :
- **6 zones d'ombre résolues** (décisions utilisateur sur branching, périmètre C1, action sur bugs, tests, feature flags via SystemConfig, compat snapshots)
- **5 phases séquentielles sur 1 branche unique** : A (préparation — tests d'arête + guards + cartographie), B (C4 Strangler Fig — consommateurs migrés, façade legacy conservée), C (C1 extraction fonctions pures), D (bugs fantômes 4.3/4.4 — audit + correction), E (finalisation)
- **1 PR consolidée** (`audit/p0-implementation` → `main`) avec commits atomiques par sous-étape — **mergée**
- **3 feature flags** via `SystemConfig` (table `system_config`) : `feature.risk_config_legacy_facade`, `feature.risk_config_strict`, `feature.deprecated_fallbacks_enabled`
- **Rollback global** documenté (feature flag SystemConfig pour rollback granulaire C4 + `git revert` pour rollback complet)
- **Suite** : Phase F = purge physique legacy RiskConfig (branche `audit/p0-riskconfig-purge`, PR séparée) après période d'observation

| Phase | Chantier | Statut |
|-------|----------|--------|
| A | Préparation (tests + guards + cartographie) | ✅ Mergée |
| B | C4 RiskConfig Strangler Fig (migration consommateurs ; façade retenue) | ✅ Mergée |
| C | C1 sim/real extraction (fonctions pures + constantes) | ✅ Mergée |
| D | Bugs fantômes 4.3/4.4 (audit + correction) | ✅ Mergée |
| E | Finalisation + PR consolidée | ✅ Mergée (PR #1) |
| F | Purge physique RiskConfig | ⏸️ Reportée |

---

*Fin du plan. Ce fichier doit être mis à jour à chaque étape complétée (voir §0).*