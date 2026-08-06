# PLAN — Audit global codebase : alignement doc, structure, conflits, bugs fantômes

> **Date de création** : 2026-08-06
> **Périmètre** : Monorepo Polywatch-v1.1 (7 packages + docs + tools + e2e) **Règle d'or** : Ce plan est **vivant**. À chaque étape terminée, mettre à jour ce fichier (statut, dates, observations, écarts détectés). Toute modification de code ou de doc effectuée pendant l'audit doit être reflétée ici.

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


| Phase                                         | Statut                                                                 | Dernière mise à jour |
| --------------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
| Phase 1 — Cartographie initiale               | ✅ Terminée                                                             | 2026-08-06           |
| Phase 1b — Vérification des constats (C1-C17) | ✅ Terminée                                                             | 2026-08-06           |
| Phase 1c — Analyse des risques & mitigations  | ✅ Terminée                                                             | 2026-08-06           |
| Phase 1d — Plan d'implémentation P0           | ✅ Terminée (A–E mergés PR #1 ; **F implémentée** `b219a7f` sur `main`) | 2026-08-06           |
| Phase 2 — Audit doc↔code (par module)         | ⏳ En cours (2.7/2.8/2.11 faits)                                        | 2026-08-06           |
| Phase 3 — Audit structurel & refactor         | ⏳ Partiel (3.1/3.5/3.8 faits)                                          | 2026-08-06           |
| Phase 4 — Audit bugs fantômes                 | ⏳ Partiel (4.3/4.4/4.9 faits)                                          | 2026-08-06           |
| Phase 5 — Synthèse & corrections              | ⏳ En attente                                                           | —                    |


> **Resync 2026-08-06** : plan parent aligné sur le code post-PR #1 + Phase F (`b219a7f`). Les todos ci-dessous marqués ✅ P0 / ✅ F ne doivent pas être rejoués.

---



## 1. Contexte de la codebase (résumé de la cartographie)

Polywatch est un monorepo npm workspaces (7 packages) de copy-trading sur Polymarket, double mode (simulation/réel), avec trading algorithmique crypto et météo.

### 1.1 Topologie des packages


| Package        | Rôle                                                                       | Fichiers src | Lignes approx |
| -------------- | -------------------------------------------------------------------------- | ------------ | ------------- |
| `core`         | Logique métier partagée (entités, services, risk, sizing, sim, polymarket) | 657          | ~36k          |
| `backend`      | API Express + Socket.IO + JWT + flux wallet                                | ~120         | ~10k          |
| `worker`       | Exécution CLOB/sim, SL/TP, janitors                                        | ~80          | ~12k          |
| `copy-trading` | Détection moves traders → `order-signals`                                  | ~40          | ~4k           |
| `crypto-algo`  | Trading algo crypto (stratégies, price feed, surveillance)                 | 35           | ~5.7k         |
| `weather-algo` | Trading algo météo city-first                                              | 18           | ~3k           |
| `frontend`     | UI SolidJS (Vite, port 5173)                                               | 552          | ~30k          |




### 1.2 Documentation technique principale

**12 fichiers racine** (`docs/*.md`) + **9 fichiers** `docs/code/*.md` + ~80 fichiers d'historique (audits/plans/patchs/v1).

### 1.3 Constats structurels majeurs (de la cartographie)

Ces constats guident les étapes d'audit ci-dessous. **Source : [Explore core structure](cbf99968-f242-4b27-860d-659d11934561), [Explore crypto-algo](418cf19d-6d28-4f20-9d26-10e83b4dedd5), [Explore frontend/backend/worker](3a9c69cf-4d27-4431-87d7-3cecf61f166f), [Explore docs**](2d9a7f76-fdf1-49f4-928d-57e51b59686e).


| #   | Constat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Sévérité                      | Modules concernés                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| C1  | **Duplication massive sim/real** (~10 paires quasi-identiques). **Partiel P0** : extract `decision-collector-shared.ts` + tests parity ; services archive/session/types **non fusionnés** (décision Q2)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 🟡 Moyenne (était 🔴)         | `core/simulation/` ↔ `core/real/`, `core/services/sim-`* ↔ `core/services/real-*`, `core/types/sim-*` ↔ `core/types/real-*` |
| C2  | **Quartet de services de config dupliqués** (`Global/Copy/Crypto/WeatherConfigService` structurellement identiques)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 🟡 Moyenne                    | `core/services/*-config.service.ts`                                                                                         |
| C3  | **Fonctions utilitaires dupliquées** (`toIso` ×6, `traderDisplayLabel` ×3, `rollupKey` ×3, `isPostgres` ×2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 🟡 Moyenne                    | `core/services/`, `core/simulation/`, `core/real/`                                                                          |
| C4  | `RiskConfig` **legacy — PURGÉ (Phase F** `b219a7f`**)** : entité, façade `composeRiskConfig`/`getConfig`, `risk-config-api`, guards divergence, flags legacy/strict retirés. Source de vérité = 4 tables isolées via `RiskService.get*Config`. Reliquat tests corrigé 2026-08-06                                                                                                                                                                                                                                                                                                                                                                                  | ✅ Clos                        | `risk.service.ts` (getters isolés)                                                                                          |
| C5  | **3 utilitaires Polymarket dupliqués dans 3 packages** (`circuit-breaker`, `rate-limited-fetch`, `token-bucket` quasi-identiques ; `api-client` NON identique : core=minimal 47 lignes, worker/copy-trading=riche 68-130 lignes)                                                                                                                                                                                                                                                                                                                                                                                                                                  | 🟡 Moyenne                    | `core/polymarket/`, `worker/polymarket/`, `copy-trading/polymarket/`                                                        |
| C6  | **God-objects** : `crypto-algo/index.ts` (519 lignes wiring), `crypto-algo/strategy/strategy-runner.ts` (856 lignes), `frontend/UpDownPriceChart.tsx` (1219 lignes), `backend/routes/simulation.ts` (691 lignes), `core/risk/policy.ts` (alléger post-F — getters legacy retirés)                                                                                                                                                                                                                                                                                                                                                                                 | 🟡 Moyenne                    | voir colonne modules                                                                                                        |
| C7  | **Frontière floue** `core/market/` **vs** `core/polymarket/` : `polymarket/market-list.ts:8` réexporte `marketClassifier` et contient `isMarketActive` (`:47`, logique métier) ; `isMarketNotExpired`/`isMarketUpcoming` sont dans `auto-track-discovery.ts:147,168`                                                                                                                                                                                                                                                                                                                                                                                              | 🟢 Mineure                    | `core/market/`, `core/polymarket/`                                                                                          |
| C8  | **Duplication** `crypto-algo` **↔** `weather-algo` : `strategy-runner.ts`, `*-entry-pipeline.ts`, `*-exit-evaluator.ts`, `auto-track-janitor.ts`, `runtime-status.ts`, `watchlist-seed.ts`, `constants.ts` quasi-identiques                                                                                                                                                                                                                                                                                                                                                                                                                                       | 🟡 Moyenne                    | `crypto-algo/src/`, `weather-algo/src/`                                                                                     |
| C9  | **Code mort / dépréciations non purgées** dans crypto-algo : `buildMarkdownReport` (monitor.ts:642, jamais appelé), `MAX_ENTRIES_PER_WINDOW` (strategy-runner.ts:64, 0 consommateur), `loadSlQuotaCount`/`isSlQuotaReached` (sl-quota.ts:85/114, 0 consommateur), `SPREAD_BY_INTERVAL`/`getMaxSpreadForInterval` (constants.ts:40/85, remplacé par `getMaxSpreadAbsForInterval`). ⚠️ `RE_ENTRY_WINDOW_MS` + TTL constants = `@deprecated` mais **actifs en fallback** (strategy-runner.ts:152,439,948). NB : `GAMMA_STALE_ON_ERROR_TTL_FACTOR`/`gammaCacheTtlFallback` ne sont **pas** marqués `@deprecated` (plan initial inexact). 6 exports deprecated (pas 5) | 🟢 Mineure                    | `crypto-algo/`                                                                                                              |
| C10 | `post-entry-mid-logger.ts` — ✅ terminé (entité `post_entry_mid_samples`, `onSample`, cancel close Redis, rétention 14j)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ Clos                        | `crypto-algo/src/post-entry-mid-logger.ts`                                                                                  |
| C11 | `docs/code/README.md` **stale** : ~~titre "v0.1.0", date 2026-07-22, weather-algo non listé~~ → **rafraîchi 2026-08-06** (`08-weather-algo.md` au sommaire)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ Clos                        | `docs/code/README.md`                                                                                                       |
| C12 | `docs/audit-api-alignement.md` **obsolète** — routes `system-audit`, weather capital/executions, crypto-algo-monitor **ajoutées à** `api.md` (2026-08-06). `config-per-kind` déjà documenté. Audit historique encore stale.                                                                                                                                                                                                                                                                                                                                                                                                                                       | 🟢 Mineure (audit historique) | `docs/api.md`                                                                                                               |
| C13 | **Lacune doc weather-algo** : ~~pas de~~ `docs/code/08-weather-algo.md` → **créé 2026-08-06**. `docs/weather-algo.md` = 67 lignes (synthèse)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ Clos (doc)                  | `docs/code/08-weather-algo.md`                                                                                              |
| C14 | **Modules non documentés** : `backend/src/e2e/` (absent de `05-backend.md`), `tools/recover-stranded-redemption/` (README non référencé dans `docs/README.md`), `crypto-algo/scripts/monitor.ts` (absent de `configuration.md`). NB : `e2e/` racine EST documenté (`01-architecture.md:20` + `configuration.md:301-304`) — plan initial inexact sur ce point                                                                                                                                                                                                                                                                                                      | 🟡 Moyenne                    | multiple                                                                                                                    |
| C15 | **14 migrations récentes** (0081-0094, non 13) sur weather-algo + split RiskConfig + crypto-algo strategy. `docs/code/03-core.md:36` dit "69 migrations" vs 79 fichiers réels (écart 10). Seule `SimBalancePerAlgoKind` (0084) mentionnée dans doc technique (`snapshots-simulation.md:407`)                                                                                                                                                                                                                                                                                                                                                                      | 🟡 Moyenne                    | `core/migrations/`                                                                                                          |
| C16 | Modules runtime crypto-algo — ✅ documentés dans `docs/crypto-algo.md` §8 (2026-08-06)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ Clos                        | `docs/crypto-algo.md`                                                                                                       |
| C17 | `monitor.ts` **(672 lignes)** : 3 requêtes SQL interpolent `${hours}` (`:84`, `:135`, `:172`), `hours = Math.max(1, Number(env))` sans garde NaN. Source = env var (pas HTTP) → risque actuel proche de zéro. NB : `conditionId` n'est **jamais interpolé** (plan initial inexact). Sévérité reclassée 🟢 Mineure (était 🟡)                                                                                                                                                                                                                                                                                                                                      | 🟢 Mineure                    | `crypto-algo/src/scripts/monitor.ts`                                                                                        |


---



## 1b. Vérification des constats (C1-C17) — 2026-08-06

> Vérification par lecture du code réel. Sources : [Verify core claims](a411d433-b2d3-40f5-a452-72290b14f53d), [Verify crypto-algo claims](b27581c0-b8fa-421e-a757-aff9ebc58ddf), [Verify documentation claims](4d01f137-7348-4c4b-940b-b9eb937ab109).



### Résultats de vérification


| Constat | Statut                        | Correction appliquée au plan                                                                                                                                                   |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1      | ✅ Confirmé                    | Post-P0 : extract collectors partiel — sévérité ↓ 🟡                                                                                                                           |
| C2      | ✅ Confirmé                    | —                                                                                                                                                                              |
| C3      | ✅ Confirmé                    | —                                                                                                                                                                              |
| C4      | ✅ Confirmé puis **PURGÉ (F)** | Post-F : entité absente ; sévérité ↓ 🟢 reliquat tests                                                                                                                         |
| C5      | ⚠️ Corrigé                    | `api-client` retiré des "dupliqués" (core=minimal, worker/copy-trading=riche)                                                                                                  |
| C6      | ✅ Confirmé                    | —                                                                                                                                                                              |
| C7      | ⚠️ Corrigé                    | `isMarketNotExpired`/`isMarketUpcoming` sont dans `auto-track-discovery.ts`, pas `market-list.ts`                                                                              |
| C8      | ✅ Confirmé                    | —                                                                                                                                                                              |
| C9      | ⚠️ Corrigé                    | `GAMMA_STALE_ON_ERROR_TTL_FACTOR`/`gammaCacheTtlFallback` ne sont PAS deprecated (plan inexact) ; 6 exports deprecated (pas 5) ; `RE_ENTRY_WINDOW_MS` + TTL actifs en fallback |
| C10     | ✅ Confirmé                    | —                                                                                                                                                                              |
| C11     | ✅ Confirmé                    | —                                                                                                                                                                              |
| C12     | ⚠️ Corrigé                    | `api.md` = 295 lignes (pas 231) ; `market-chart` EST documenté (`api.md:217`) — retiré des routes manquantes                                                                   |
| C13     | ⚠️ Corrigé                    | `docs/weather-algo.md` = 67 lignes (pas 89)                                                                                                                                    |
| C14     | ⚠️ Corrigé                    | `e2e/` racine EST documenté (`01-architecture.md:20` + `configuration.md:301-304`) — sous-affirmation "non documenté" réfutée                                                  |
| C15     | ⚠️ Corrigé                    | 14 migrations (pas 13) ; `03-core.md:36` dit "69" vs 79 réels                                                                                                                  |
| C16     | ⚠️ Corrigé                    | `mid-history-buffer` (`:51`) et `auto-track-janitor` (`:33`) SONT mentionnés — retirés de la liste                                                                             |
| C17     | ⚠️ Corrigé                    | `conditionId` jamais interpolé (plan inexact) ; sévérité reclassée 🟢 Mineure (risque actuel proche de zéro, source = env var)                                                 |




### Décisions utilisateur prises (2026-08-06)


| #   | Décision                                                                                                                                                                                                                        | Impact                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C4  | **Terminer la transition** — purger `RiskConfig.ts`, getters legacy, `risk-config-api`, migrer consommateurs → 4 tables isolées                                                                                                 | ✅ **FAIT** (P0 A–E + Phase F `b219a7f` + reliquat tests)                   |
| C5  | **Centraliser les 3 utilitaires identiques** (`circuit-breaker`, `token-bucket`, `rate-limited-fetch`) dans `core/polymarket/` et réexporter ; **laisser** `api-client` **spécifique** à chaque package                         | 🟡 P2 — refactor structurel                                                |
| C8  | **NE PAS abstraire** crypto↔weather — documenter le miroir + converger par copie consciente (annexe §R6)                                                                                                                        | 🟢 P3 — doc only (pas d'`AlgoStrategyRunner` partagé)                      |
| C10 | **Terminer la feature post-entry-mid-logger**                                                                                                                                                                                   | ✅ **FAIT** (entité + migration 0095 + onSample + cancel Redis + rétention) |
| C9  | **Purger les constantes deprecated** — remplacer `RE_ENTRY_WINDOW_MS`, `MAX_ENTRIES_PER_WINDOW`, TTL constants par les resolvers core (`resolveCryptoAlgoReentryParams`, `resolveGammaCacheTtlMs`), supprimer le fallback local | 🟢 P3 — nettoyage                                                          |
| C1  | **Extraction fonctions pures + constantes seulement** (Q2) — PAS de `ModeSession<>` ; PAS fusion archive/session services                                                                                                       | ✅ **Partiel P0** — collectors partagés ; reste = mesure drift + doc miroir |


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
- [x] Confirmer statut `RiskConfig.ts` legacy (C4) — ✅ **PURGÉ** Phase F (`b219a7f`) : fichier absent, retiré de `data-source` / barrel
- [ ] Vérifier que les 4 nouvelles entités config (`GlobalConfig`, `CopyConfig`, `CryptoConfig`, `WeatherConfig`) sont documentées dans `modele-donnees.md` (et que toute mention monolithique `RiskConfig` est retirée / archivée)
- [ ] Vérifier la cohérence `data-source.ts` : entités enregistrées vs `entities/index.ts` exports (post-F : pas de `RiskConfig`)
- [x] **Reliquat C4** : migrer les 4 tests qui importent encore `entities/RiskConfig.js` → types isolés (`CryptoConfig` / fixtures) ✅ 2026-08-06
- [ ] **Observations** :
  - ✅ 2026-08-06 Phase F : purge physique legacy. Reliquat tests **corrigé** (`crypto-algo-{reentry,exit,helpers,tunables}.test.ts` → `CryptoConfig` / `CopyConfig` ; 66 tests verts).



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

- [x] Vérifier `docs/crypto-algo.md` + `docs/code/07-crypto-algo.md` contre `packages/crypto-algo/src/` ✅ 2026-08-06
- [x] Compléter la doc pour les modules non nommés (C16) ✅ — §8 Modules runtime + arborescence `07-` + post-entry-mid
- [x] Vérifier pipeline `price tick → signal → entry` — déjà couvert ; abstentions = **15** codes (plan disait 14)
- [x] Vérifier topologie timers `index.ts` — documentée dans §8
- [x] Vérifier `core/crypto-algo/` (optimize-report) — déjà en §9
- [ ] **Observations** :
  - ✅ 2026-08-06 : C16 clos. AbstainReasonCode = 15 (ajout `curve_insufficient`).



#### 2.8 — `@polywatch/backend`

- [x] Vérifier `docs/api.md` + routes récentes (C12) ✅ 2026-08-06
- [ ] Vérifier `docs/metrics.md` contre `backend/src/metrics.ts` (état juillet)
- [x] Auditer / documenter routes : `system-audit`, `crypto-algo-monitor`, `weather-algo-executions`, `weather-algo-capital` ✅ ; `config-per-kind` déjà en tête `api.md` ; `market-chart` déjà documenté
- [ ] Vérifier le module `backend/src/e2e/` (C14) — non documenté
- [ ] Recenser les routes internes `/api/internal/*` …
- [ ] **Observations** :
  - ✅ 2026-08-06 : sections Weather capital/executions + Système audit/monitor ajoutées à `api.md`.



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

- [x] **Créer** `docs/code/08-weather-algo.md` (C13) — arborescence, fichiers, resilience patterns, shutdown ✅ 2026-08-06
- [x] Vérifier `docs/weather-algo.md` contre `weather-algo/src/` (18 fichiers) — aligné (city-first, exits, standby) ; détail technique dans `08-`
- [x] Vérifier la duplication `crypto-algo` ↔ `weather-algo` (C8) — section « Miroir crypto-algo » dans `08-` ; **pas** d'abstraction
- [x] Vérifier `docs/architecture.md` § Weather-Algo contre `weather-algo/src/index.ts` ✅ — aligné ; lien vers `08-` ajouté
- [x] Mettre à jour `docs/code/README.md` (C11 partiel : titre stale + sommaire weather) ✅
- [ ] **Observations** :
  - ✅ 2026-08-06 : `08-weather-algo.md` créé ; C11/C13 comblés ; architecture cross-check OK.



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

- [x] Mesurer / extraire identité collectors — ✅ P0 Phase C : `core/snapshot/decision-collector-shared.ts` + tests parity
- [ ] Mesurer l'identité entre `simulation/trader-rollup.ts` ↔ `real/trader-rollup.ts` (diff réel) — reste ouvert
- [ ] Mesurer l'identité entre `services/simulation-archive.service.ts` ↔ `services/real-archive.service.ts` (diff ; **ne pas fusionner** — Q2)
- [ ] Mesurer l'identité entre `services/simulation-session.service.ts` ↔ `services/real-session.service.ts` (diff ; **ne pas fusionner** — Q2)
- [x] Évaluer `ModeSession<Snap,Archive>` — ✅ **Rejeté** (Q2) : trop rigide ; composition fonctions pures seulement
- [ ] **Observations** :
  - ✅ 2026-08-06 P0-C : extract DTO/constantes collectors. Suite = mesure drift archive/session/rollup + doc du miroir (2.4).



#### 3.2 — Quartet de services de config (C2)

- [ ] Comparer `global-config.service.ts`, `copy-config.service.ts`, `crypto-config.service.ts`, `weather-config.service.ts` (diff structurel)
- [ ] Évaluer l'extraction d'une classe `BaseConfigService<T extends object>` dans `core/services/`
- [ ] **Observations** :



#### 3.3 — Utilitaires dupliqués (C3, C5)

- [ ] Recenser toutes les copies de `toIso`, `traderDisplayLabel`, `rollupKey`, `isPostgres` et centraliser dans `core/lib/`
- [ ] Recenser les copies de `circuit-breaker.ts`, `rate-limited-fetch.ts`, `token-bucket.ts` (3 packages) et centraliser dans `core/polymarket/` + re-export shim — `api-client` **exclu** (spécifique par package, décision C5)
- [ ] **Observations** :



#### 3.4 — God-objects (C6)

- [ ] `crypto-algo/index.ts` (519 lignes) — évaluer l'extraction d'un `CryptoAlgoBootstrap` + sous-modules wiring (shutdown déjà extrait en P0-D)
- [ ] `crypto-algo/strategy/strategy-runner.ts` (856 lignes) — évaluer l'extraction du cache Gamma, du re-entry throttle, du SL quota en sous-modules
- [ ] `frontend/UpDownPriceChart.tsx` (1219 lignes) — évaluer l'extraction de la logique de rendu vs canvas
- [ ] `backend/routes/simulation.ts` (691 lignes) — évaluer le split par endpoint
- [ ] `core/risk/policy.ts` — re-mesurer taille post-F (getters legacy retirés) ; split wrappers algo-kind si encore massif
- [ ] **Observations** :



#### 3.5 — RiskConfig legacy (C4) — ✅ CLOS (Phase F)

- [x] Confirmer migration `0088` (`DropLegacyRiskConfig`) — table droppée ; entité purgeée
- [x] Migrer consommateurs runtime vers 4 tables isolées (P0 Phase B)
- [x] Purge physique : `RiskConfig.ts`, `risk-config-api.ts`, `composeRiskConfig`/`getConfig` legacy, guards, flags legacy/strict (Phase F `b219a7f`)
- [x] **Reliquat** : corriger imports `RiskConfig` dans `crypto-algo-reentry.test.ts`, `crypto-algo-exit.test.ts`, `crypto-algo-helpers.test.ts`, `crypto-algo-tunables.test.ts` ✅ 2026-08-06
- [ ] **Observations** :
  - ✅ 2026-08-06 : C4 clos côté runtime **et** reliquat tests. Plus d'import `entities/RiskConfig.js` (hors `RiskConfigRevision`).



#### 3.6 — Code mort / dépréciations (C9)

- [ ] Vérifier consommateurs de `buildMarkdownReport` (monitor.ts) — code mort confirmé ?
- [ ] Vérifier consommateurs de `gammaCacheTtlFallback` + constantes TTL locales (strategy-runner.ts) — flag `deprecated_fallbacks_enabled` déjà branché (P0)
- [ ] Vérifier consommateurs des exports `@deprecated` (sl-quota, constants, strategy-runner) — compter réel post-P0
- [ ] Planifier la purge si confirmé (après observation logs fallbacks)
- [ ] **Observations** :



#### 3.7 — Duplication crypto-algo ↔ weather-algo (C8)

- [ ] Comparer `crypto-algo/strategy/strategy-runner.ts` ↔ `weather-algo/strategy/strategy-runner.ts` (mesure drift)
- [ ] Comparer `crypto-algo/processors/algo-entry-pipeline.ts` ↔ `weather-algo/processors/weather-entry-pipeline.ts`
- [x] Extraction `AlgoStrategyRunner` dans `core/` — ✅ **Rejeté** (décision C8 / §R6) : documenter le miroir + converger par copie consciente
- [ ] Documenter le pattern partagé dans `docs/code/08-weather-algo.md` + `docs/crypto-algo.md`
- [ ] **Observations** :



#### 3.8 — `post-entry-mid-logger.ts` (C10) — ✅ FAIT

- [x] Persistance `PostEntryMidSample` (entité + migration `0095`)
- [x] `onSample` branché dans `index.ts` (save DB)
- [x] Cancellation par `positionId` + canal Redis `algo-position-closed` (worker → crypto-algo)
- [x] Janitor rétention 14 j (horaire)
- [x] Tests cancel + schedule verts
- [ ] **Observations** :
  - ✅ 2026-08-06 : feature terminée (§R5).

---



### Phase 4 — Audit bugs fantômes

> Pour chaque zone à risque : regime perturbé (panne DB/Redis/WS, shutdown, charge, reconnexion), états incohérents, races, fuites.



#### 4.1 — RiskConfig double source de vérité (C4) — ✅ CLOS (Phase F)

- [x] Scénario divergence legacy vs `CryptoConfig` — façade + guard installés (P0-A/B) puis **retirés** (F) ; plus de double source runtime
- [x] `RiskService` = getters isolés uniquement post-F (plus de `composeRiskConfig`)
- [x] Smoke : boot + hot path config sans import `RiskConfig` ; corriger reliquat tests ✅
- [ ] **Observations** :
  - ✅ 2026-08-06 : risque double source éliminé. Reliquat tests corrigé. Ne plus auditer comme P0.



#### 4.2 — Duplication sim/real (C1) — drift silencieux

- [ ] Scénario : bug corrigé dans `simulation-archive.service.ts` mais pas dans `real-archive.service.ts` (miroir) → comportement divergent sim/real
- [x] Collectors : constantes partagées via `decision-collector-shared.ts` (P0-C) — drift collectors mitigé
- [ ] Vérifier autres paires (rollup, session, types) pour constantes encore dupliquées
- [ ] **Observations** :



#### 4.3 — `crypto-algo/index.ts` shutdown (C6) — ✅ FAIT (P0-D)

- [x] Scénario SIGTERM pendant évaluation — audit + correctifs P0-D (`shutdown.ts`, tests)
- [x] Scénario SIGTERM pendant `runAlgoEntryPipeline`
- [x] Ordre de shutdown (timers, Redis, DS)
- [ ] **Observations** :
  - ✅ 2026-08-06 P0-D : ne pas rejouer sauf régression.



#### 4.4 — `strategy-runner.ts` cache Gamma + re-entry (C6, C9) — ✅ FAIT (P0-D)

- [x] Redis down / re-entry fail-closed — audité + corrigé P0-D
- [x] WS reconnect / midHistory / Gamma stale
- [x] `config-changed` atomique
- [x] Fallback Gamma TTL + flag `deprecated_fallbacks_enabled`
- [ ] **Observations** :
  - ✅ 2026-08-06 P0-D. Suite C9 = purge fallbacks après observation (3.6).



#### 4.5 — `sim-reset-redis-hygiene.ts` (470 lignes, hub critique)

- [ ] Scénario reset sim pendant qu'un worker consomme `algo-order-signals` : le worker voit-il la purge ? Race condition ?
- [ ] Scénario reset sim pendant qu'un signal est en `:processing` : le `recoverOrphans` au prochain boot le réinjecte-t-il alors que la queue a été purgée ?
- [ ] Vérifier que tous les canaux pub/sub et throttles sont bien purgés (liste exhaustive)
- [ ] **Observations** :



#### 4.6 — `monitor.ts` injection SQL (C17)

- [ ] Vérifier que `env.durationHours` est validé (type, range, garde NaN) avant interpolation SQL `${hours}`
- [x] `conditionId` — **jamais interpolé** (C17 corrigé) ; hors scope
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



#### 4.9 — `post-entry-mid-logger.ts` timers (C10) — ✅ FAIT

- [x] Position fermée avant +30s → cancel via `algo-position-closed`
- [x] Shutdown → `clearPostEntryMidTimers()`
- [ ] **Observations** :
  - ✅ 2026-08-06.



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

> **Resync 2026-08-06** : les P0 code (C4 purge, 4.3/4.4, extract C1 collectors, filet tests) sont **faits**. Tableau ci-dessous = **reste à faire**.


| Priorité     | Étapes                                                                                 | Raison                                      |
| ------------ | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| 🔴 P0 (fait) | ~~C4 / 3.5 / 4.1~~, ~~4.3~~, ~~4.4~~, ~~RT filet~~                                     | Historique PR #1 + Phase F — ne pas rejouer |
| 🟡 P1        | ~~**2.7** crypto-algo doc~~, ~~**2.11** weather~~, ~~**2.8** routes api~~              | ✅ 2026-08-06                                |
| 🟡 P1        | ~~**3.8 / C10** post-entry-mid-logger~~                                                | ✅ 2026-08-06                                |
| 🟡 P1        | **4.5** sim-reset hygiene, **4.2** drift sim/real restant                              | Hubs critiques + miroir non extracté        |
| 🟢 P2        | **2.1–2.6** reste audit doc core, **2.9–2.10**, **2.12–2.14**                          | Exhaustivité doc                            |
| 🟢 P2        | **3.2** quartet config, **3.3** utils (+ C5 sans api-client), **3.4** god-objects      | Refactor structurel                         |
| 🟢 P3        | **3.6 / C9** purge fallbacks, **3.7 / C8** doc miroir (pas d'abstraction), C11/C15/C16 | Nettoyage + doc                             |




### Proposition d'exécution (reste)

1. ~~**Hotfix** : corriger les 4 tests qui importent~~ `RiskConfig` ~~(reliquat F).~~ ✅
2. ~~**Doc critique** : 2.11 / 2.7 / 2.8.~~ ✅
3. ~~**Feature** : C10 post-entry-mid-logger (§R5).~~ ✅
4. **Bugs restants** : 4.5 sim-reset, puis 4.6/4.7/4.8/4.10.
5. **Structure** : 3.1 reste (mesure drift) → 3.3/C5 → 3.2/3.4 ; C8 = doc only.
6. **Phase 5** : synthèse une fois 4.5 + audits doc restants couverts.

> **Migration** : ✅ `CreatePostEntryMidSamples1700000000095` jouée (`npm run migration:run -w @polywatch/core`, 2026-08-06).

---



## 5. Annexes



### 5.1 Cartographie détaillée des packages (source : agents d'exploration)



#### `packages/core` — 26 sous-dossiers, 657 fichiers, ~36k lignes


| Sous-dossier      | Fichiers | Lignes | Fichier max (lignes)                         |
| ----------------- | -------- | ------ | -------------------------------------------- |
| `services/`       | 67       | 13 382 | `execution.service.ts` (653)                 |
| `risk/`           | 25       | 4 802  | `policy.ts` (659)                            |
| `migrations/`     | 79       | 4 774  | `SplitRiskConfigPerAlgoKind...0087.ts` (699) |
| `polymarket/`     | 41       | 4 224  | `market-list.ts` (550)                       |
| `entities/`       | 51       | 2 859  | *(post-F :* `RiskConfig.ts` *purgé)*         |
| `simulation/`     | 21       | 2 723  | `trader-pnl-series.test.ts` (311)            |
| `sizing/`         | 23       | 1 886  | `compute.test.ts` (184)                      |
| `weather/`        | 16       | 1 820  | `weather-market-discovery.ts` (368)          |
| `crypto-algo/`    | 8        | 1 392  | `optimize-report.ts` (464)                   |
| `market/`         | 11       | 1 368  | `tags.ts` (280)                              |
| `redis/`          | 13       | 1 092  | `sim-reset-redis-hygiene.ts` (470)           |
| `trader-insight/` | 6        | 1 026  | `build-trader-funding.ts` (260)              |
| `types/`          | 10       | 864    | `index.ts` (223)                             |
| `lib/`            | 5        | 676    | `algo-price-tick-snapshot.ts` (230)          |
| `positions/`      | 9        | 669    | `redemption-wait.ts` (155)                   |
| `worker-shared/`  | 5        | 432    | `redis-queue.ts` (152)                       |
| `database/`       | 3        | 421    | `data-source.ts` (356)                       |
| `seed/`           | 4        | 417    | `risk-config-backfill.test.ts` (168)         |
| `pricing/`        | 6        | 392    | `vwap.ts` (134)                              |
| `real/`           | 3        | 364    | `snapshot-decision-collector.ts` (232)       |
| `orders/`         | 8        | 338    | `close-signal.ts` (108)                      |
| `config/`         | 3        | 234    | `secrets.ts` (117)                           |
| `idempotence/`    | 2        | 188    | `hash.ts` (99)                               |
| `queue/`          | 2        | 79     | `worker-queues.ts` (43)                      |
| `worker/`         | 2        | 47     | `move-detector-settings.ts` (26)             |
| `move-events/`    | 2        | 37     | `relevance.ts` (24)                          |




#### `packages/crypto-algo` — 35 fichiers, ~5.7k lignes


| Fichier                                               | Lignes | Rôle                                                                                |
| ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `strategy/strategy-runner.ts`                         | 856    | God-class runtime (cache Gamma, re-entry, SL quota, eval loop, WS wiring)           |
| `processors/algo-entry-pipeline.ts`                   | 640    | Pipeline entry sim/real (cooldown, SL quota, réservation, sizing, MOS, depth retry) |
| `strategy/implementations/naive-momentum.strategy.ts` | 529    | Stratégie builtin (band, spread, curve, price selection)                            |
| `index.ts`                                            | 519    | God-file wiring (DataSource, Redis, SelectionLoader, Registry, Runner, Janitors)    |
| `price-feed.ts`                                       | 400    | CryptoAlgoPriceFeed (WS CLOB, cache top-of-book, debounce, mid-history)             |
| `market-surveillance-recorder.ts`                     | 279    | MarketSurveillanceRecorder (snapshots open/close)                                   |
| `price-tick-recorder.ts`                              | 244    | PriceTickRecorder (algo_price_ticks 1s)                                             |
| `strategy/sl-quota.ts`                                | 194    | SL quota par marché/mode (SQL + cache + pub/sub)                                    |
| `strategy/strategy.ts`                                | 142    | Types/interfaces (AlgoSignal, AbstainReasonCode, StrategyContext)                   |




#### `packages/frontend` — 552 fichiers, ~30k lignes


| Fichier                                   | Lignes | Rôle                                               |
| ----------------------------------------- | ------ | -------------------------------------------------- |
| `components/UpDownPriceChart.tsx`         | 1219   | Graphique prix Up/Down (canvas lourd)              |
| `api.ts`                                  | 710    | Client REST central (JWT, refresh, tous endpoints) |
| `hooks/useSimulationSnapshots.ts`         | 665    | Hook snapshots simulation                          |
| `hooks/useRealSnapshots.ts`               | 636    | Hook snapshots réel                                |
| `lib/snapshot-config-diff.ts`             | 627    | Diff config entre snapshots                        |
| `components/RealSnapshotsPanel.tsx`       | 580    | Panneau snapshots réel                             |
| `components/SimulationSnapshotsPanel.tsx` | 576    | Panneau snapshots sim                              |
| `components/TraderProfilePage.tsx`        | 526    | Page profil trader                                 |
| `components/NewSessionResetDialog.tsx`    | 526    | Dialogue reset session                             |
| `components/CryptoAlgoReportViewer.tsx`   | 490    | Visualiseur rapports crypto-algo                   |




#### Doublons Polymarket confirmés (C5)


| Fichier                            | Packages                   | Statut                                                             |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `polymarket/circuit-breaker.ts`    | core, worker, copy-trading | 3 copies                                                           |
| `polymarket/rate-limited-fetch.ts` | core, worker, copy-trading | 3 copies identiques                                                |
| `polymarket/token-bucket.ts`       | core, worker, copy-trading | 3 copies                                                           |
| `polymarket/api-client.ts`         | core, worker, copy-trading | 3 copies **non identiques** — **ne pas centraliser** (décision C5) |
| `polymarket/book-freshness.ts`     | core, worker               | 2 copies                                                           |
| `helpers.ts`                       | worker, copy-trading       | 2 copies                                                           |




### 5.2 Documentation — doublons et lacunes

**Doublons intentionnels (vue synthétique vs détaillée)** :


| Module                | Fichiers en doublon                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Architecture          | `docs/architecture.md` ↔ `docs/code/01-architecture.md`                                     |
| Pipeline copy-trading | `docs/pipeline-copy-trading.md` ↔ `docs/code/02-pipeline-copy-trading.md`                   |
| Crypto-algo           | `docs/crypto-algo.md` ↔ `docs/code/07-crypto-algo.md`                                       |
| Frontend              | `docs/frontend.md` ↔ `docs/code/06-frontend.md`                                             |
| Worker                | `docs/code/04-worker.md` + `docs/simulation-execution.md` + `docs/pipeline-copy-trading.md` |
| Modèle données        | `docs/modele-donnees.md` ↔ `docs/code/03-core.md`                                           |


**Lacunes de couverture doc** :


| Module non documenté                                                        | Action requise                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/weather-algo` (doc technique détaillée)                           | ✅ Créé `docs/code/08-weather-algo.md` (2026-08-06)                       |
| `packages/backend/src/e2e/`                                                 | Documenter dans `docs/code/05-backend.md`                                |
| `e2e/` (tests Playwright + helpers)                                         | Créer section dans `docs/`                                               |
| `tools/recover-stranded-redemption/`                                        | Référencer le README dans `docs/README.md`                               |
| `crypto-algo/src/scripts/monitor.ts`                                        | Documenter + audit SQL                                                   |
| Routes backend récentes (system-audit, weather-algo-*, crypto-algo-monitor) | ✅ Documentées dans `docs/api.md` (2026-08-06)                            |
| Migrations 0081-0095                                                        | Inventaire dans `docs/code/03-core.md` (+ 0095 `post_entry_mid_samples`) |




### 5.3 Risques et mitigations

> **Référence annexe** : `[docs/plans/2026-08-06_ANNEXE-risques-mitigations.md](2026-08-06_ANNEXE-risques-mitigations.md)`
> **Date** : 2026-08-06 — 9 risques + 1 risque transversal identifiés et mitigés.

L'analyse des risques a couvert les 9 zones critiques du plan (C1, C4, C5, C6, C8, C9, C10, C12 + process discipline) ainsi qu'un risque transversal (absence de filet de tests). L'annexe détaillée contient pour chaque risque : le contexte précis (avec références fichier:ligne), la stratégie de mitigation adaptée à la codebase, les garde-fous concrets, le plan de rollback et le séquencement recommandé.

**Tableau récapitulatif des 9 risques** (état post-P0/F) :


| #   | Risque                             | Sévérité                  | Stratégie de mitigation       | Réf annexe | État 2026-08-06                             |
| --- | ---------------------------------- | ------------------------- | ----------------------------- | ---------- | ------------------------------------------- |
| 1   | C4 : Purge RiskConfig legacy       | ~~🔴 P0~~ → clos          | Strangler Fig + guard         | §R1        | ✅ Fait (A–E + F `b219a7f`)                  |
| 2   | C1 : Refactor duplication sim/real | 🟡 reste                  | Composition fonctions pures   | §R2        | ✅ Collectors ; reste archive/session/rollup |
| 3   | C9 : Purge deprecated constants    | 🟢 P3                     | Éliminer fallback             | §R3        | ⏳ Flag branché ; purge après observation    |
| 4   | C6 : Refactor god-objects          | 🟡 P2                     | Extraction conservatrice      | §R4        | ⏳ Partiel (shutdown extrait)                |
| 5   | C10 : Finish post-entry-mid-logger | ~~🟡 P1~~ → clos          | Entité + migration + cancel   | §R5        | ✅ Fait                                      |
| 6   | C8 : Abstract crypto↔weather       | 🟢 P3                     | **NE PAS abstraire** — doc    | §R6        | ⏳ Doc only                                  |
| 7   | Process discipline                 | 🟢 P3                     | Automatisation légère         | §R7        | ⏳                                           |
| 8   | C5 : Centralize Polymarket         | 🟢 P2                     | Move + shim (sans api-client) | §R8        | ⏳                                           |
| 9   | C12 : Update api.md                | ~~🟡 P1~~ → clos (routes) | Routes manquantes             | §R9        | ✅ `api.md` ; audit historique optionnel     |
| T   | No test safety net                 | ~~🔴 P0~~ → clos          | Filet d'arête                 | §RT        | ✅ Fait (Phase A)                            |


**Principes transversaux** (détaillés dans l'annexe § Recommandations transversales) :

- Stratégie de branching : 1 branche dédiée par chantier restant (C6, C5), 1 PR par branche — C4/C1/C10 déjà traités.
- Feature flags : seul `feature.deprecated_fallbacks_enabled` reste post-F ; flags RiskConfig legacy/strict retirés.
- Ordre d'exécution A–F : **terminé** (voir §5.4). Suite = §4 « Proposition d'exécution (reste) ».
- **Règle d'or** : aucun refactor critique ne commence avant que le test d'arête correspondant existe et soit vert.



### 5.4 Plan d'implémentation P0

> **Référence** : `[docs/plans/2026-08-06_PLAN-p0-implementation.md](2026-08-06_PLAN-p0-implementation.md)`
> **Date** : 2026-08-06 — Plan d'implémentation des priorités P0 (C4 RiskConfig, C1 sim/real, bugs fantômes 4.3/4.4 + filet de tests).
> **Statut** : ✅ **Phases A–E mergées** dans `main` via [PR #1](https://github.com/Lucas-dev-974/polywatch/pull/1) (`81571ba`). ✅ **Phase F implémentée** sur `main` (`b219a7f` — purge physique RiskConfig legacy). PR GitHub Phase F / tags optionnels encore ouverts côté plan P0 enfant.

Ce plan opérationnalise les mitigations de l'annexe §R1, §R2, §R4, §RT pour les 3 chantiers P0. Il contient :

- **6 zones d'ombre résolues** (décisions utilisateur sur branching, périmètre C1, action sur bugs, tests, feature flags via SystemConfig, compat snapshots)
- **5 phases séquentielles sur 1 branche unique** : A (préparation — tests d'arête + guards + cartographie), B (C4 Strangler Fig — consommateurs migrés, façade legacy conservée), C (C1 extraction fonctions pures), D (bugs fantômes 4.3/4.4 — audit + correction), E (finalisation)
- **1 PR consolidée** (`audit/p0-implementation` → `main`) avec commits atomiques par sous-étape — **mergée**
- **Phase F** (`audit/p0-riskconfig-purge`) : suppression `RiskConfig.ts`, façade, API legacy, guards, flags `legacy_facade`/`strict` — **implémentée** (`b219a7f` sur `main`)
- **3 feature flags** (état post-F) : `feature.deprecated_fallbacks_enabled` **conservé** ; `feature.risk_config_legacy_facade` et `feature.risk_config_strict` **retirés du seed** (plus de code à piloter)
- **Rollback** : post-F = `git revert` de `b219a7f` (plus de rollback granulaire façade)


| Phase | Chantier                                                               | Statut                               |
| ----- | ---------------------------------------------------------------------- | ------------------------------------ |
| A     | Préparation (tests + guards + cartographie)                            | ✅ Mergée                             |
| B     | C4 RiskConfig Strangler Fig (migration consommateurs ; façade retenue) | ✅ Mergée                             |
| C     | C1 sim/real extraction (fonctions pures + constantes)                  | ✅ Mergée                             |
| D     | Bugs fantômes 4.3/4.4 (audit + correction)                             | ✅ Mergée                             |
| E     | Finalisation + PR consolidée                                           | ✅ Mergée (PR #1)                     |
| F     | Purge physique RiskConfig                                              | ✅ Implémentée (`b219a7f` sur `main`) |


**Reliquat post-F** : ✅ tests unitaires migrés vers `CryptoConfig`/`CopyConfig` (2026-08-06).

---

*Fin du plan. Ce fichier doit être mis à jour à chaque étape complétée (voir §0).*