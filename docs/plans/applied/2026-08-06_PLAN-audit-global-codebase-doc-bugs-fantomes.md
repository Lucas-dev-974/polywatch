# PLAN — Audit global codebase : alignement doc, structure, conflits, bugs fantômes

> **Date de création** : 2026-08-06 · **Dernière resync** : 2026-08-07 (C9 + SL/TP fail-closed, audit **terminé**)
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
| Phase 2 — Audit doc↔code (par module)         | ✅ Terminée                                                             | 2026-08-06           |
| Phase 3 — Audit structurel & refactor         | ✅ Terminée (extracts C1/C2/C5 ; C8 doc ; C9 audit sans purge aveugle)   | 2026-08-07           |
| Phase 4 — Audit bugs fantômes                 | ✅ Terminée (P2 worker abort+shuttingDown clos 2026-08-07)              | 2026-08-07           |
| Phase 5 — Synthèse & corrections              | ✅ Clos ; reste ops fallbacks Gamma                                     | 2026-08-07           |


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
| C9  | **Code mort / dépréciations** dans crypto-algo — ✅ **clos 2026-08-07** : code mort purgé ; fallbacks Gamma/re-entry (`RE_ENTRY_WINDOW_MS`, TTL locales, `resolveGammaCacheTtlOrFallback`) supprimés ; TTL via `CryptoConfig` uniquement | ✅ Clos                        | `crypto-algo/`                                                                                                              |
| C10 | `post-entry-mid-logger.ts` — ✅ terminé (entité `post_entry_mid_samples`, `onSample`, cancel close Redis, rétention 14j)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ Clos                        | `crypto-algo/src/post-entry-mid-logger.ts`                                                                                  |
| C11 | `docs/code/README.md` **stale** : ~~titre "v0.1.0", date 2026-07-22, weather-algo non listé~~ → **rafraîchi 2026-08-06** (`08-weather-algo.md` au sommaire)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ Clos                        | `docs/code/README.md`                                                                                                       |
| C12 | `docs/audit-api-alignement.md` **obsolète** — routes `system-audit`, weather capital/executions, crypto-algo-monitor **ajoutées à** `api.md` (2026-08-06). `config-per-kind` déjà documenté. Audit historique encore stale.                                                                                                                                                                                                                                                                                                                                                                                                                                       | 🟢 Mineure (audit historique) | `docs/api.md`                                                                                                               |
| C13 | **Lacune doc weather-algo** : ~~pas de~~ `docs/code/08-weather-algo.md` → **créé 2026-08-06**. `docs/weather-algo.md` = 67 lignes (synthèse)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ Clos (doc)                  | `docs/code/08-weather-algo.md`                                                                                              |
| C14 | **Modules non documentés** : `backend/src/e2e/` (absent de `05-backend.md`), `tools/recover-stranded-redemption/` (README non référencé dans `docs/README.md`), `crypto-algo/scripts/monitor.ts` (absent de `configuration.md`). NB : `e2e/` racine EST documenté (`01-architecture.md:20` + `configuration.md:301-304`) — plan initial inexact sur ce point                                                                                                                                                                                                                                                                                                      | 🟡 Moyenne                    | multiple                                                                                                                    |
| C15 | **15 migrations** 0081–0095. Compteur **80** fichiers. Inventaire tabulaire ✅ dans `03-core.md` (2026-08-07).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅ Clos (doc)                  | `docs/code/03-core.md`                                                                                                      |
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
| C9      | ✅ Clos 2026-08-07             | Code mort purgé ; fallbacks Gamma/re-entry supprimés (`6d99017`) ; TTL via resolvers core uniquement |
| C10     | ✅ Confirmé                    | —                                                                                                                                                                              |
| C11     | ✅ Confirmé                    | —                                                                                                                                                                              |
| C12     | ⚠️ Corrigé                    | `api.md` = 295 lignes (pas 231) ; `market-chart` EST documenté (`api.md:217`) — retiré des routes manquantes                                                                   |
| C13     | ⚠️ Corrigé                    | `docs/weather-algo.md` = 67 lignes (pas 89)                                                                                                                                    |
| C14     | ⚠️ Corrigé                    | `e2e/` racine EST documenté (`01-architecture.md:20` + `configuration.md:301-304`) — sous-affirmation "non documenté" réfutée                                                  |
| C15     | ✅ Clos (doc)                  | Compteur **80** ; inventaire 0081–0095 dans `03-core.md` (2026-08-07)                                                                                                          |
| C16     | ⚠️ Corrigé                    | `mid-history-buffer` (`:51`) et `auto-track-janitor` (`:33`) SONT mentionnés — retirés de la liste                                                                             |
| C17     | ⚠️ Corrigé                    | `conditionId` jamais interpolé (plan inexact) ; sévérité reclassée 🟢 Mineure (risque actuel proche de zéro, source = env var)                                                 |




### Décisions utilisateur prises (2026-08-06)


| #   | Décision                                                                                                                                                                                                                        | Impact                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C4  | **Terminer la transition** — purger `RiskConfig.ts`, getters legacy, `risk-config-api`, migrer consommateurs → 4 tables isolées                                                                                                 | ✅ **FAIT** (P0 A–E + Phase F `b219a7f` + reliquat tests)                   |
| C5  | **Centraliser les 3 utilitaires identiques** (`circuit-breaker`, `token-bucket`, `rate-limited-fetch`) dans `core/polymarket/` et réexporter ; **laisser** `api-client` **spécifique** à chaque package                         | ✅ Fait (shims 2026-08-07)                                                  |
| C8  | **NE PAS abstraire** crypto↔weather — documenter le miroir + converger par copie consciente (annexe §R6)                                                                                                                        | 🟢 P3 — doc only (pas d'`AlgoStrategyRunner` partagé)                      |
| C10 | **Terminer la feature post-entry-mid-logger**                                                                                                                                                                                   | ✅ **FAIT** (entité + migration 0095 + onSample + cancel Redis + rétention) |
| C9  | **Purger les constantes deprecated** — remplacer par resolvers core, supprimer fallbacks locaux | ✅ **FAIT** 2026-08-07 (`6d99017`) |
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

- [x] Vérifier `docs/modele-donnees.md` contre `core/entities/*.ts` (47 entités documentées vs réelles) ✅ 2026-08-06 — réel = **50** ; doc corrigée
- [x] Vérifier `docs/code/03-core.md` § entités contre `core/entities/index.ts` (barrel exports) ✅
- [x] Confirmer statut `RiskConfig.ts` legacy (C4) — ✅ **PURGÉ** Phase F (`b219a7f`) : fichier absent, retiré de `data-source` / barrel
- [x] Vérifier que les 4 nouvelles entités config (`GlobalConfig`, `CopyConfig`, `CryptoConfig`, `WeatherConfig`) sont documentées dans `modele-donnees.md` (et que toute mention monolithique `RiskConfig` est retirée / archivée) ✅ doc corrigée
- [x] Vérifier la cohérence `data-source.ts` : entités enregistrées vs `entities/index.ts` exports (post-F : pas de `RiskConfig`) ✅ 50 = 50
- [x] **Reliquat C4** : migrer les 4 tests qui importent encore `entities/RiskConfig.js` → types isolés (`CryptoConfig` / fixtures) ✅ 2026-08-06
- [ ] **Observations** :
  - ✅ 2026-08-06 Phase F : purge physique legacy. Reliquat tests **corrigé**.
  - ✅ 2026-08-06 audit + correctifs doc : `modele-donnees.md` / `03-core.md` — `RiskConfig` live retiré ; 4 configs + `PostEntryMidSample` + `RiskConfigRevision`/`AnalysisReport` au tableau. Barrel ↔ DS alignés. **Reste** : `configuration.md` mentionne encore `risk_config` (champs) — à traiter en 2.3.



#### 2.2 — `@polywatch/core` : services (67 fichiers, 13k lignes)

- [x] Vérifier `docs/code/03-core.md` § services : 41 services documentés vs 67 fichiers réels ✅ 2026-08-06 — réel = **68** fichiers / 49 hors tests ; compteur doc corrigé
- [x] Identifier les 26 services non documentés (…) ✅ liste plan **stale** — la plupart déjà documentés ; restants = quartet C2 + backfill + helpers algo-surveillance
- [x] Vérifier la description du quartet de config dupliqué (C2) — ✅ 2026-08-06 noté manquant ; ✅ 2026-08-07 `BaseConfigService<T>` extrait + doc `03-core.md`
- [ ] **Observations** :
  - ✅ 2026-08-06 : quartet + `MarketPriceHistoryBackfillService` ajoutés au tableau § Services ; doublon `MarketResolutionService` retiré. Helpers `algo-surveillance.*` / serializer encore optionnels en doc.



#### 2.3 — `@polywatch/core` : risk + sizing + pricing + positions

- [x] Vérifier `docs/code/03-core.md` § risk contre `core/risk/` (25 fichiers) ✅ 2026-08-06 — réel = **23** ; § risk réécrit (getters algo-kind, exit-decision, tunables)
- [x] Vérifier `docs/configuration.md` § RiskConfig … ✅ refs `risk_config`/`RiskConfig` corrigées → configs isolées ; `cryptoAlgoEntryPriceMin` 0.55 ; migration SL quota ajoutée
- [x] Vérifier `docs/crypto-algo.md` § tunables ✅ `CryptoConfig`/`GlobalConfig` ; `getCryptoMaxPositionSizeUsdc`
- [x] Vérifier que `docs/weather-algo.md` mentionne weather-exit-params + weather-config-api ✅
- [x] Vérifier sizing — `entry-mos` / `resolve-entry-mos` / depth-retry ajoutés à `03-core.md`
- [ ] **Observations** :
  - ✅ 2026-08-06 : P0 doc RiskConfig stale corrigé dans configuration/crypto-algo/03-core. **Reste P2** : scinder mega-tableau config par table ; doc `cryptoAlgoStrategyParams` détaillée ; Weather SL/TP fields dans configuration.md.



#### 2.4 — `@polywatch/core` : simulation + real (miroir)

- [x] Vérifier `docs/snapshots-simulation.md` contre `core/simulation/` + services ✅ 2026-08-06
- [x] Vérifier `docs/snapshots-real.md` contre `core/real/` + services ✅
- [x] Documenter explicitement la duplication sim/real (C1) ✅ section « Miroir sim/real » ajoutée aux deux docs
- [x] Vérifier `docs/simulation-execution.md` contre tunables + accounting ✅ titre → `GlobalConfig`
- [ ] **Observations** :
  - ✅ 2026-08-06 : RiskConfig→GlobalConfig/configs isolées sur snapshots + sim-exec + 04-worker. C1 documenté (tableau correspondance + decision-collector-shared).



#### 2.5 — `@polywatch/core` : migrations (79 fichiers)

- [x] Vérifier `docs/code/03-core.md` mentionne "69 migrations" vs 79 fichiers réels (C15) ✅ → **80** fichiers ; compteur corrigé
- [x] Créer un inventaire des migrations 0081-0094 (récentes) … ✅ partiel : 0084–0086/0088/0095 cités ; inventaire exhaustif reporté P2
- [x] Vérifier `docs/configuration.md` (bande, curve, SL quota) ✅ bande/curve OK ; SL quota `0044` ajouté
- [ ] **Observations** :
  - ✅ 2026-08-06 C15 : 69→80. ✅ 2026-08-07 inventaire tabulaire 0081–0095 dans `03-core.md`.



#### 2.6 — `@polywatch/core` : polymarket + market + redis

- [x] Vérifier `docs/code/03-core.md` § polymarket contre `core/polymarket/` ✅ sections scindées + catalogue modules clés
- [x] Vérifier la frontière `market/` vs `polymarket/` (C7) ✅ documentée
- [x] Vérifier `core/redis/` — hygiene/throttles ✅ arborescence + crypto-reentry dans crypto-algo.md + weather modules dans weather-algo.md
- [ ] **Observations** :
  - ✅ 2026-08-06 : C7 + redis paths documentés. Catalogue polymarket exhaustif encore optionnel.



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
- [x] Vérifier `docs/metrics.md` contre `backend/src/metrics.ts` ✅ — TIME_EXIT fantôme retiré ; chemins `/api/internal/metrics/*`
- [x] Auditer / documenter routes : `system-audit`, `crypto-algo-monitor`, `weather-algo-executions`, `weather-algo-capital` ✅ ; `config-per-kind` déjà en tête `api.md` ; `market-chart` déjà documenté
- [x] Vérifier le module `backend/src/e2e/` (C14) ✅ section ajoutée à `05-backend.md`
- [x] Recenser les routes internes `/api/internal/*` ✅ + 4 routes metrics ajoutées à `api.md`
- [ ] **Observations** :
  - ✅ 2026-08-06 : routes metrics internes + e2e module + metrics.md alignés. Seed bootstrap `05-backend` → 4 configs.



#### 2.9 — `@polywatch/worker`

- [x] Vérifier `docs/code/04-worker.md` + `docs/simulation-execution.md` contre `worker/src/` ✅ 2026-08-06 (correctifs P0)
- [x] Vérifier les processors contre la doc ✅ (TIME_EXIT retiré ; chemins corrigés)
- [x] Vérifier la description des janitors ✅ SimRealism path + table Watchdogs
- [x] Vérifier la duplication `polymarket/` dans worker (C5) ✅ note C5 ajoutée
- [ ] **Observations** :
  - ✅ 2026-08-06 : chemins SimRealism/MarketPriceHistorySyncer, TIME_EXIT, C5, Watchdogs. **Reste P2** : ordre boot détaillé, dual executor A/B, heartbeat.



#### 2.10 — `@polywatch/copy-trading`

- [x] Vérifier `docs/pipeline-copy-trading.md` + `docs/code/05-copy-trading.md` contre `copy-trading/src/` ✅ P0 config corrigé
- [x] Vérifier les pipelines entry/exit, MoveDetector, CopyProcessor ✅ partiel (MOS/depth mentionnés dans 02-)
- [x] Vérifier la duplication `polymarket/` dans copy-trading (C5) ✅ section C5 dans `05-`
- [ ] **Observations** :
  - ✅ 2026-08-06 : `risk_config`/`getMode*` → `CopyConfig`/`getCopy*` ; C5 documenté. **Reste P2** : réécriture complète flux entry (ordre filtres) dans pipeline.md.



#### 2.11 — `@polywatch/weather-algo` (lacune doc)

- [x] **Créer** `docs/code/08-weather-algo.md` (C13) — arborescence, fichiers, resilience patterns, shutdown ✅ 2026-08-06
- [x] Vérifier `docs/weather-algo.md` contre `weather-algo/src/` (18 fichiers) — aligné (city-first, exits, standby) ; détail technique dans `08-`
- [x] Vérifier la duplication `crypto-algo` ↔ `weather-algo` (C8) — section « Miroir crypto-algo » dans `08-` ; **pas** d'abstraction
- [x] Vérifier `docs/architecture.md` § Weather-Algo contre `weather-algo/src/index.ts` ✅ — aligné ; lien vers `08-` ajouté
- [x] Mettre à jour `docs/code/README.md` (C11 partiel : titre stale + sommaire weather) ✅
- [ ] **Observations** :
  - ✅ 2026-08-06 : `08-weather-algo.md` créé ; C11/C13 comblés ; architecture cross-check OK.



#### 2.12 — `@polywatch/frontend`

- [x] Vérifier `docs/frontend.md` + `docs/code/06-frontend.md` contre `frontend/src/` ✅ 2026-08-06 (~302 src, pas 552)
- [x] Vérifier weather + crypto settings ✅ arbre Weather* + EntryTab ; fantômes HardExit/Notifications retirés
- [x] Vérifier `UpDownPriceChart.tsx` ✅ documenté (SVG ~1219 L, pas canvas)
- [x] Vérifier `api.ts` ✅ cache/429/façade config ; inventaire routes = `api.md`
- [ ] **Observations** :
  - ✅ 2026-08-06 : SYSTEM tabs + monitor ; Snapshots hors Simulation ; Weather UI ; stores notés. P2 : inventaire hooks exhaustif.



#### 2.13 — `tools/`, `e2e/`, `scripts/`

- [x] Vérifier `docs/configuration.md` §8 (scripts) contre `tools/` ✅ scripts manquants clés ajoutés
- [x] Documenter `tools/recover-stranded-redemption/` ✅ lien `docs/README.md`
- [x] Documenter `e2e/` (organisation, helpers, suites) ✅ note dans configuration.md
- [x] Vérifier `crypto-algo/src/scripts/monitor.ts` (C17) ✅ code clos + entrée configuration.md
- [ ] **Observations** :
  - ✅ 2026-08-06 C14 partiellement clos (recover, monitor, e2e scripts). Inventaire exhaustif tools one-shot = optionnel.



#### 2.14 — Audits/plans/patchs (historique)

- [x] Vérifier que `docs/README.md` référence les audits/patchs récents (août) ✅
- [x] Vérifier `docs/code/README.md` (C11) ✅ déjà rafraîchi ; liens août ajoutés
- [x] Identifier les audits appliqués ✅ marqueurs RiskConfig/weather/sim-reset/C10
- [ ] **Observations** :
  - ✅ 2026-08-06 : README + code/README enrichis.

---



### Phase 3 — Audit structurel & refactor

> Identifier les fichiers massifs, les responsabilités multiples, les découpages nécessaires, la cohérence.



#### 3.1 — Duplication sim/real (C1)

- [x] Mesurer / extraire identité collectors — ✅ P0 Phase C : `core/snapshot/decision-collector-shared.ts` + tests parity
- [x] Mesurer l'identité entre `simulation/trader-rollup.ts` ↔ `real/trader-rollup.ts` (diff réel) ✅ 2026-08-06 — drift ~5 %, miroir mécanique
- [x] Mesurer l'identité entre `services/simulation-archive.service.ts` ↔ `services/real-archive.service.ts` (diff ; **ne pas fusionner** — Q2) ✅ ~30–40 % drift domaine
- [x] Mesurer l'identité entre `services/simulation-session.service.ts` ↔ `services/real-session.service.ts` (diff ; **ne pas fusionner** — Q2) ✅ ~35–45 % drift domaine
- [x] Évaluer `ModeSession<Snap,Archive>` — ✅ **Rejeté** (Q2) : trop rigide ; composition fonctions pures seulement
- [x] Extract pure `trader-rollup-shared` + wrappers minces ✅ 2026-08-07
- [x] Centraliser `safeParseJson` (`core/lib/safe-parse-json.ts`) ✅ 2026-08-07
- [ ] **Observations** :
  - ✅ 2026-08-06 P0-C : extract DTO/constantes collectors.
  - ✅ 2026-08-06 mesure drift : rollup quasi-identique ; archive/session = squelette cloné + divergences légitimes. Pas de `ModeSession`.
  - ✅ 2026-08-07 : `snapshot/trader-rollup-shared.ts` (`buildTraderRollup` + helpers) ; sim/real = thin wrappers ; `safeParseJson` unique ; `applyDecisionPayloadByteBudget` + `lib/to-iso` / `lib/is-postgres`.



#### 3.2 — Quartet de services de config (C2)

- [x] Comparer `global-config.service.ts`, `copy-config.service.ts`, `crypto-config.service.ts`, `weather-config.service.ts` (diff structurel) ✅ 2026-08-07 — structure identique (cache + get/update)
- [x] Extraction `BaseConfigService<T>` dans `core/services/` ✅ 2026-08-07 — quartet étend la base ; `invalidateConfigCache()` static préservé
- [ ] **Observations** :
  - ✅ 2026-08-07 : `base-config.service.ts` + export `services/index.ts`. Doc `03-core.md` alignée. Pas de changement de comportement (TTL 5 s, bypass cache si manager).



#### 3.3 — Utilitaires dupliqués (C3, C5)

- [x] Recenser copies `toIso` / `traderDisplayLabel` / `rollupKey` / `isPostgres` ✅ 2026-08-07 — inventaire ; `traderDisplayLabel`/`rollupKey` centralisés via rollup-shared ; `toIso`/`isPostgres` encore locaux (helpers 1-liner, extract P3 optionnel)
- [x] Centraliser `circuit-breaker` / `rate-limited-fetch` / `token-bucket` — shims worker + copy-trading → `@polywatch/core` ✅ 2026-08-07 — `api-client` **exclu**
- [ ] **Observations** :
  - ✅ 2026-08-07 C5 : implémentation canonique = `core/polymarket/` ; packages runtime = re-export shims. Buckets identiques (150/1000/1500 / 10s). Build worker + copy-trading OK.



#### 3.4 — God-objects (C6)

- [x] `crypto-algo/index.ts` (~648 lignes) — évaluer Bootstrap ✅ 2026-08-07 — shutdown déjà extrait (P0-D) ; reste = wiring timers/Redis — extract `CryptoAlgoBootstrap` **reporté** (ROI faible vs risque)
- [x] `crypto-algo/strategy/strategy-runner.ts` (~1038 lignes) — évaluer sous-modules ✅ 2026-08-07 — SL quota / re-entry déjà fichiers dédiés ; Gamma+eval loop restent ; extract Gamma cache **après** purge C9
- [x] `frontend/UpDownPriceChart.tsx` (1219 lignes) — évaluer ✅ 2026-08-07 — logique déjà dans `lib/updown-price-chart` + overlays + `useChartWidth` ; fichier = SVG/UI ; split `UpDownChartSvg` optionnel P3
- [x] `backend/routes/simulation.ts` (691 lignes) — évaluer split ✅ 2026-08-07 — un seul `createSimulationRouter` ; split endpoints = cosmétique, **non fait**
- [x] `core/risk/policy.ts` (~565 lignes) — re-mesurer post-F ✅ 2026-08-07 — déjà allégé ; pas de split requis
- [ ] **Observations** :
  - ✅ 2026-08-07 : évaluation seule, **aucune extraction agressive**. Priorité restante = runner après C9 ; chart déjà partiellement découpé.



#### 3.5 — RiskConfig legacy (C4) — ✅ CLOS (Phase F)

- [x] Confirmer migration `0088` (`DropLegacyRiskConfig`) — table droppée ; entité purgeée
- [x] Migrer consommateurs runtime vers 4 tables isolées (P0 Phase B)
- [x] Purge physique : `RiskConfig.ts`, `risk-config-api.ts`, `composeRiskConfig`/`getConfig` legacy, guards, flags legacy/strict (Phase F `b219a7f`)
- [x] **Reliquat** : corriger imports `RiskConfig` dans `crypto-algo-reentry.test.ts`, `crypto-algo-exit.test.ts`, `crypto-algo-helpers.test.ts`, `crypto-algo-tunables.test.ts` ✅ 2026-08-06
- [ ] **Observations** :
  - ✅ 2026-08-06 : C4 clos côté runtime **et** reliquat tests. Plus d'import `entities/RiskConfig.js` (hors `RiskConfigRevision`).



#### 3.6 — Code mort / dépréciations (C9)

- [x] Vérifier consommateurs de `buildMarkdownReport` (monitor.ts) — ✅ 2026-08-07 mort confirmé (défini, 0 appel)
- [x] Vérifier `resolveGammaCacheTtlOrFallback` + TTL locales — ✅ 2026-08-07 purgés ; TTL Gamma via `CryptoConfig` uniquement ; seed `feature.deprecated_fallbacks_enabled=false`
- [x] Vérifier exports `@deprecated` (sl-quota, constants, strategy-runner) ✅ 2026-08-07
- [x] Planifier la purge (après observation logs) ✅
- [x] **Purge code mort sûr** ✅ 2026-08-07 — `buildMarkdownReport`, `loadSlQuotaCount`/`isSlQuotaReached`, `SPREAD_BY_INTERVAL`/`getMaxSpreadForInterval`, `MAX_ENTRIES_PER_WINDOW`
- [x] **Observations** :
  - ✅ 2026-08-07 inventaire + purge safe appliquée.
  - ✅ 2026-08-07 **fallbacks Gamma/re-entry purgés** : `RE_ENTRY_WINDOW_MS`, `OUTCOME_PRICES_CACHE_TTL_*`, `resolveGammaCacheTtlOrFallback`, `setDeprecatedFallbacksEnabled` retirés ; flag seed `false` (legacy DB only).



#### 3.7 — Duplication crypto-algo ↔ weather-algo (C8)

- [x] Comparer runners ✅ 2026-08-07 — crypto ~1038 L vs weather ~608 L ; squelette commun, drift domaine (WS/exit vs poll/forecast)
- [x] Comparer entry pipelines ✅ ~680 vs ~545 L — même MOS/reserve, files/reasons distinctes
- [x] Extraction `AlgoStrategyRunner` dans `core/` — ✅ **Rejeté** (décision C8 / §R6) : documenter le miroir + converger par copie consciente
- [x] Documenter le pattern partagé dans `docs/code/08-weather-algo.md` + `docs/crypto-algo.md` (+ `07-crypto-algo.md`) ✅ 2026-08-07
- [ ] **Observations** :
  - ✅ 2026-08-07 : § Miroir déjà dans `08-weather-algo.md` ; ajout §10 `crypto-algo.md` + § Miroir `07-crypto-algo.md`. Convention review `[mirror: weather-algo/…]`.



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

- [x] Scénario : bug corrigé dans `simulation-archive.service.ts` mais pas dans `real-archive.service.ts` (miroir) → comportement divergent sim/real ✅ 2026-08-06 (mesuré ; archive/session non fusionnés — Q2)
- [x] Collectors : constantes partagées via `decision-collector-shared.ts` (P0-C) — drift collectors mitigé
- [x] Vérifier autres paires (rollup, session, types) pour constantes encore dupliquées ✅ 2026-08-06
- [x] Extract `trader-rollup-shared` + `safeParseJson` ✅ 2026-08-07 (voir §3.1)
- [ ] **Observations** :
  - ✅ 2026-08-06 : risque fantôme mesuré (rollup / truncation archive / prune).
  - ✅ 2026-08-07 **resync** : extract `snapshot/trader-rollup-shared.ts` + wrappers sim/real + `lib/safe-parse-json.ts` **faits** (plus P2). Reste optionnel P3 : truncation decision archive partagée ; `toIso`/`isPostgres`. Archive/session services restent séparés (Q2).



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
- [x] Fallback Gamma TTL + flag `deprecated_fallbacks_enabled` (P0-D) → fallbacks **purged** 2026-08-07
- [x] **Observations** :
  - ✅ 2026-08-06 P0-D (flag + warn). ✅ 2026-08-07 purge complète §3.6 — voir commit `6d99017`.



#### 4.5 — `sim-reset-redis-hygiene.ts` (470 lignes, hub critique)

- [x] Scénario reset sim pendant qu'un worker consomme `algo-order-signals` : le worker voit-il la purge ? Race condition ? ✅ 2026-08-06
- [x] Scénario reset sim pendant qu'un signal est en `:processing` : le `recoverOrphans` au prochain boot le réinjecte-t-il alors que la queue a été purgée ? ✅ 2026-08-06
- [x] Vérifier que tous les canaux pub/sub et throttles sont bien purgés (liste exhaustive) ✅ 2026-08-06
- [ ] **Observations** :
  - ✅ 2026-08-06 audit + correctifs partiels :
    - **Bug P0 corrigé** : cooldown purgéait `algo-entry-cooldown:{logicalKey}:sim` alors que prod écrit `{conditionId}:sim` (`algo-entry-cooldown.ts`). Fix : `hints.conditionIds` + `algoEntryCooldownKey`. Tests unit + e2e alignés. Doc `snapshots-simulation.md` corrigée.
    - **Bug P1 corrigé** : marqueurs `close-signals:enqueued:weather-close:{posId}:{reason}` non purgés → DEL ciblé pour weather.
    - **Mitigation TOCTOU** : double passe LREM main/`:processing` (entry/close/results/move-events).
    - ✅ 2026-08-07 **P2 clos** : `SimResetGeneration` + `wrapSimResetAwareHandler` → `JobDiscardedError` (pas de RPUSH post-purge sur échec sim in-flight).
    - ✅ 2026-08-07 **P3 clos** : purge sim-filtrée des listes `${queue}:dead` + DEL `` `${raw}::retries` `` (compteurs `deadLetterRemoved` / `jobRetryKeysRemoved`). Pub/sub = publish only (N/A).



#### 4.6 — `monitor.ts` injection SQL (C17)

- [x] Vérifier que `env.durationHours` est validé (type, range, garde NaN) avant interpolation SQL `${hours}` ✅ 2026-08-06 — fix `sanitizePositiveNumber` (finite, min 1, max 48)
- [x] `conditionId` — **jamais interpolé** (C17 corrigé) ; hors scope
- [x] Vérifier que les autres paramètres SQL (interval, mode) ne viennent jamais d'une entrée utilisateur ✅ — colonnes DB only ; HTTP déjà sanitisé côté backend
- [ ] **Observations** :
  - ✅ 2026-08-06 : pas d'injection exploitable. Gap CLI NaN/Infinity corrigé dans `monitor.ts`. C17 clos.



#### 4.7 — Queue consumers worker (shutdown)

- [x] Scénario : consumer `order-signals` crash → `process.exit(1)` (doc confirme) mais les autres consumers sont-ils tués proprement ? ✅ 2026-08-06
- [x] Scénario : `execution-results` en `:processing` au crash → `recoverOrphans` au reboot réinjecte-t-il dans la bonne queue ? ✅ 2026-08-06
- [ ] **Observations** :
  - ✅ 2026-08-06 : `recoverOrphans` OK (bonne file). Crash → `exit(1)` tue tout le process (voulu, anti-zombie).
  - ✅ 2026-08-07 **P2 clos** : flag `shuttingDown` (pattern copy-trading) — consumer stop pendant SIGTERM = log info, pas `exit(1)`. Doc `architecture.md` corrigée (5 files).



#### 4.8 — Polymarket WS book (worker + crypto-algo)

- [x] Scénario : WS Polymarket drop pendant 30s → `book-freshness.ts` marque stale, mais les évaluations continuent-elles avec un book périmé ? ✅ 2026-08-06
- [x] Scénario : `forceRefreshBook` REST échoue → fallback sur cache stale ou abstention ? ✅ 2026-08-06
- [x] **Observations** :
  - ✅ 2026-08-06 : entrées crypto-algo fail-closed à 15s (`stale_book`). **Fix** : `entry-depth-retry` passe `maxAgeMs` + skip si `forceRefreshBook` → `undefined`.
  - ✅ 2026-08-07 : SL/TP worker **fail-closed** à 30s (`BOOK_FRESHNESS_WARN_MAX_AGE_MS`) — skip sans close si book stale. SELL peut encore utiliser cache stale (hors scope).



#### 4.9 — `post-entry-mid-logger.ts` timers (C10) — ✅ FAIT

- [x] Position fermée avant +30s → cancel via `algo-position-closed`
- [x] Shutdown → `clearPostEntryMidTimers()`
- [ ] **Observations** :
  - ✅ 2026-08-06.



#### 4.10 — Frontend : `UpDownPriceChart.tsx` (1219 lignes)

- [x] Scénario : démontage du composant pendant un `requestAnimationFrame` → leak ? ✅ 2026-08-06
- [x] Scénario : WS disconnect → le canvas continue-t-il à redraw avec des données stale ? ✅ 2026-08-06
- [ ] **Observations** :
  - ✅ 2026-08-06 : chart = SVG réactif (pas canvas/rAF loop). rAF one-shot dans `useChartWidth` — **fix** `cancelAnimationFrame` dans `onCleanup`. Live WS géré par parent (`MarketChartDialog` : `setLiveEnabled(false)` onClose + timer fin marché). Pas de redraw autonome stale.

---



### Phase 5 — Synthèse & corrections

- [x] Consolider tous les tableaux de confrontation Doc→Code et Code→Doc ✅ 2026-08-06 (ci-dessous)
- [x] Produire le rapport final classé par priorité ✅
- [x] Pour chaque point, préciser CODE ou DOCUMENTATION ✅
- [x] Appliquer les corrections doc P0/P1 de cet audit ✅ (reste polish P2 optionnel)
- [ ] Ouvrir les tickets refactor code (après validation utilisateur)
- [x] Mettre à jour `docs/README.md` pour référencer cet audit ✅
- [ ] **Observations** :
  - ✅ 2026-08-06 : rapport §5.5. Tickets refactor en attente de validation user.
  - ✅ 2026-08-06 : voir **§5.5 Rapport final** ci-dessous.

---



## 4. Ordre de priorité suggéré

> **Resync 2026-08-06** : les P0 code (C4 purge, 4.3/4.4, extract C1 collectors, filet tests) sont **faits**. Tableau ci-dessous = **reste à faire**.


| Priorité     | Étapes                                                                                 | Raison                                      |
| ------------ | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| 🔴 P0 (fait) | ~~C4 / 3.5 / 4.1~~, ~~4.3~~, ~~4.4~~, ~~RT filet~~                                     | Historique PR #1 + Phase F — ne pas rejouer |
| 🟡 P1        | ~~**2.7** crypto-algo doc~~, ~~**2.11** weather~~, ~~**2.8** routes api~~              | ✅ 2026-08-06                                |
| 🟡 P1        | ~~**3.8 / C10** post-entry-mid-logger~~                                                | ✅ 2026-08-06                                |
| 🟡 P1        | ~~**4.5** sim-reset~~ (cooldown+markers+abort in-flight), ~~**4.2** mesuré+extract~~ | ✅ Clos 2026-08-07                           |
| 🟢 P2        | ~~**Phase 2 entière**~~ ✅                                                          | Exhaustivité doc                            |
| 🟢 P2        | ~~**3.2** quartet~~, ~~**3.3**/C5~~, ~~**3.4** éval god-objects~~ ✅                   | Refactor structurel                         |
| 🟢 P3        | ~~**3.7 / C8** doc miroir~~ ✅ ; ~~**C9** purge code mort + fallbacks~~ ✅ ; polish C15 | Nettoyage + doc                             |




### Proposition d'exécution (reste)

1. ~~**Hotfix** : corriger les 4 tests qui importent~~ `RiskConfig` ~~(reliquat F).~~ ✅
2. ~~**Doc critique** : 2.11 / 2.7 / 2.8.~~ ✅
3. ~~**Feature** : C10 post-entry-mid-logger (§R5).~~ ✅
4. ~~**Bugs** : 4.5 / 4.2.~~ ✅ (+ abort in-flight + extract rollup 2026-08-07).
5. ~~**Bugs** : 4.6 → 4.7 → 4.8 → 4.10.~~ ✅ (+ `shuttingDown` worker 2026-08-07).
6. ~~**Phase 2 + Phase 5 rapport**.~~ ✅
7. ~~**Suite Phase 3** : 3.1 extract / 3.2 / 3.3/C5 / 3.4 éval / 3.7 doc / 3.6 audit.~~ ✅ 2026-08-07
8. ~~**C9 suite** : purge code mort sûr + fallbacks Gamma/re-entry.~~ ✅ 2026-08-07 (`6d99017`).
9. ~~Follow-ups P2/P3 : abort sim-reset, `shuttingDown`, dead-letter/`::retries`, inventaire C15, truncate/`toIso`/`isPostgres`, doc SL/TP stale.~~ ✅ 2026-08-07.

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
| `components/UpDownPriceChart.tsx`         | 1219   | Graphique prix Up/Down (SVG réactif ; logique dans `lib/updown-price-chart`) |
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


| Fichier                            | Packages                   | Statut (resync 2026-08-07)                                         |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `polymarket/circuit-breaker.ts`    | core, worker, copy-trading | ✅ Canonique `core` ; worker/copy-trading = **shims** re-export     |
| `polymarket/rate-limited-fetch.ts` | core, worker, copy-trading | ✅ Idem shims                                                       |
| `polymarket/token-bucket.ts`       | core, worker, copy-trading | ✅ Idem shims                                                       |
| `polymarket/api-client.ts`         | core, worker, copy-trading | 3 copies **non identiques** — **ne pas centraliser** (décision C5) |
| `polymarket/book-freshness.ts`     | core, worker               | 2 copies (hors périmètre C5)                                       |
| `helpers.ts`                       | worker, copy-trading       | 2 copies (hors périmètre C5)                                       |




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
| `packages/backend/src/e2e/`                                                 | ✅ Section `05-backend.md` (2026-08-06)                                   |
| `e2e/` (tests Playwright + helpers)                                         | ✅ Note `configuration.md`                                               |
| `tools/recover-stranded-redemption/`                                        | ✅ Lien `docs/README.md`                                                  |
| `crypto-algo/src/scripts/monitor.ts`                                        | ✅ configuration.md + garde NaN                                           |
| Routes backend récentes (system-audit, weather-algo-*, crypto-algo-monitor) | ✅ Documentées dans `docs/api.md` (2026-08-06)                            |
| Migrations 0081-0095                                                        | Compteur 80 OK ; **reste** inventaire tabulaire exhaustif (P3)           |




### 5.3 Risques et mitigations

> **Référence annexe** : `[docs/plans/2026-08-06_ANNEXE-risques-mitigations.md](2026-08-06_ANNEXE-risques-mitigations.md)` **Date** : 2026-08-06 — 9 risques + 1 risque transversal identifiés et mitigés.

L'analyse des risques a couvert les 9 zones critiques du plan (C1, C4, C5, C6, C8, C9, C10, C12 + process discipline) ainsi qu'un risque transversal (absence de filet de tests). L'annexe détaillée contient pour chaque risque : le contexte précis (avec références fichier:ligne), la stratégie de mitigation adaptée à la codebase, les garde-fous concrets, le plan de rollback et le séquencement recommandé.

**Tableau récapitulatif des 9 risques** (état post-P0/F) :


| #   | Risque                             | Sévérité                  | Stratégie de mitigation       | Réf annexe | État 2026-08-06                             |
| --- | ---------------------------------- | ------------------------- | ----------------------------- | ---------- | ------------------------------------------- |
| 1   | C4 : Purge RiskConfig legacy       | ~~🔴 P0~~ → clos          | Strangler Fig + guard         | §R1        | ✅ Fait (A–E + F `b219a7f`)                  |
| 2   | C1 : Refactor duplication sim/real | 🟡 reste                  | Composition fonctions pures   | §R2        | ✅ Collectors + rollup-shared + safeParseJson ; archive/session non fusionnés (Q2) |
| 3   | C9 : Purge deprecated constants    | ~~🟢 P3~~ → clos          | Éliminer fallback             | §R3        | ✅ 2026-08-07 — fallbacks purgés (`6d99017`) |
| 4   | C6 : Refactor god-objects          | 🟡 P2                     | Extraction conservatrice      | §R4        | ✅ Évalué 3.4 ; extracts agressifs reportés   |
| 5   | C10 : Finish post-entry-mid-logger | ~~🟡 P1~~ → clos          | Entité + migration + cancel   | §R5        | ✅ Fait                                      |
| 6   | C8 : Abstract crypto↔weather       | 🟢 P3                     | **NE PAS abstraire** — doc    | §R6        | ✅ Doc miroir (08 + crypto-algo §10 + 07)     |
| 7   | Process discipline                 | 🟢 P3                     | Automatisation légère         | §R7        | ⏳                                           |
| 8   | C5 : Centralize Polymarket         | 🟢 P2                     | Move + shim (sans api-client) | §R8        | ✅ Shims worker/copy-trading → core          |
| 9   | C12 : Update api.md                | ~~🟡 P1~~ → clos (routes) | Routes manquantes             | §R9        | ✅ `api.md` ; audit historique optionnel     |
| T   | No test safety net                 | ~~🔴 P0~~ → clos          | Filet d'arête                 | §RT        | ✅ Fait (Phase A)                            |


**Principes transversaux** (détaillés dans l'annexe § Recommandations transversales) :

- Stratégie de branching : 1 branche dédiée par chantier restant (C6, C5), 1 PR par branche — C4/C1/C10 déjà traités.
- Feature flags : `feature.deprecated_fallbacks_enabled` **legacy** (seed `false`, plus lu par le runtime depuis 2026-08-07) ; flags RiskConfig legacy/strict retirés.
- Ordre d'exécution A–F : **terminé** (voir §5.4). Suite = §4 « Proposition d'exécution (reste) ».
- **Règle d'or** : aucun refactor critique ne commence avant que le test d'arête correspondant existe et soit vert.



### 5.4 Plan d'implémentation P0

> **Référence** : `[docs/plans/2026-08-06_PLAN-p0-implementation.md](2026-08-06_PLAN-p0-implementation.md)` **Date** : 2026-08-06 — Plan d'implémentation des priorités P0 (C4 RiskConfig, C1 sim/real, bugs fantômes 4.3/4.4 + filet de tests). **Statut** : ✅ **Phases A–E mergées** dans `main` via [PR #1](https://github.com/Lucas-dev-974/polywatch/pull/1) (`81571ba`). ✅ **Phase F implémentée** sur `main` (`b219a7f` — purge physique RiskConfig legacy). PR GitHub Phase F / tags optionnels encore ouverts côté plan P0 enfant.

Ce plan opérationnalise les mitigations de l'annexe §R1, §R2, §R4, §RT pour les 3 chantiers P0. Il contient :

- **6 zones d'ombre résolues** (décisions utilisateur sur branching, périmètre C1, action sur bugs, tests, feature flags via SystemConfig, compat snapshots)
- **5 phases séquentielles sur 1 branche unique** : A (préparation — tests d'arête + guards + cartographie), B (C4 Strangler Fig — consommateurs migrés, façade legacy conservée), C (C1 extraction fonctions pures), D (bugs fantômes 4.3/4.4 — audit + correction), E (finalisation)
- **1 PR consolidée** (`audit/p0-implementation` → `main`) avec commits atomiques par sous-étape — **mergée**
- **Phase F** (`audit/p0-riskconfig-purge`) : suppression `RiskConfig.ts`, façade, API legacy, guards, flags `legacy_facade`/`strict` — **implémentée** (`b219a7f` sur `main`)
- **Feature flags** (état post-2026-08-07) : `feature.deprecated_fallbacks_enabled` conservé en seed (`false`, legacy DB only — **plus branché** dans crypto-algo) ; `feature.risk_config_legacy_facade` et `feature.risk_config_strict` retirés du seed
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

### 5.5 Rapport final (Phase 5) — 2026-08-06

#### Clos pendant cet audit

| # | Finding | Type | Action |
|---|---------|------|--------|
| C4 | RiskConfig legacy | CODE | Purge Phase F (préalable) + doc alignée |
| C10 | post-entry-mid-logger | CODE | Feature terminée (préalable) |
| 4.5 | Cooldown sim-reset mauvaise clé | CODE | Fix `conditionId` + weather-close markers + double passe |
| 4.6 | monitor.ts NaN | CODE | `sanitizePositiveNumber` |
| 4.8 | entry-depth stale book | CODE | `maxAgeMs` + skip si refresh fail |
| 4.10 | useChartWidth rAF | CODE | `cancelAnimationFrame` onCleanup |
| Doc | RiskConfig + Phase 2 modules | DOC | Alignement P0/P1 (2.1–2.14) |

#### Clos Phase 3 (2026-08-07)

| # | Finding | Type | Action |
|---|---------|------|--------|
| C1 | rollup + safeParseJson | CODE | `trader-rollup-shared` + `lib/safe-parse-json` |
| C2 | Quartet config | CODE | `BaseConfigService<T>` |
| C5 | Utils Polymarket | CODE | Shims worker/copy-trading → core (`api-client` exclu) |
| C6 | God-objects | AUDIT | Évalués ; extracts agressifs reportés |
| C8 | Miroir crypto↔weather | DOC | §10 crypto-algo + 07/08 |
| C9 | Deprecated | CODE | ✅ Clos 2026-08-07 — fallbacks purgés, TTL via `CryptoConfig` |

#### Clos follow-ups P2 (2026-08-07)

| # | Finding | Type | Action |
|---|---------|------|--------|
| 4.5 | Abort worker in-flight sim-reset | CODE | `SimResetGeneration` + `JobDiscardedError` |
| 4.7 | `shuttingDown` worker | CODE | Pattern copy-trading |
| Doc | RiskConfig / 4 files / §5.1 C5+canvas / §4.2 | DOC | Resync plan + architecture / 01 / 07 / pipeline / 03-core |

#### Clos follow-ups P3 (2026-08-07)

| # | Finding | Type | Action |
|---|---------|------|--------|
| C9 | Code mort sûr + fallbacks | CODE | Purge monitor/sl-quota/spread%/MAX_ENTRIES ; fallbacks Gamma purgés (2026-08-07) |
| C15 | Inventaire migrations 0081–0095 | DOC | Tableau `03-core.md` |
| 4.5 | Dead-letter / `::retries` sim-reset | CODE | Filtre sim sur `:dead` + DEL retry keys |
| C3 | `toIso` / `isPostgres` + truncate archive | CODE | `lib/to-iso`, `lib/is-postgres`, `applyDecisionPayloadByteBudget` |
| 4.8 | SL/TP book stale | CODE | Fail-closed 30s dans `position-exit-evaluator` + doc `04-worker.md` |

| C9 | Fallbacks Gamma/re-entry | CODE | Purge `RE_ENTRY_WINDOW_MS`, TTL locales, `resolveGammaCacheTtlOrFallback` ; seed flag `false` |

#### Clos follow-ups ops/produit (2026-08-07)

| Prio | Item | Type | Action |
|------|------|------|--------|
| 🟢 Ops | Purge fallbacks Gamma/re-entry C9 | CODE | ✅ Voir §3.6 |
| 🟢 Produit | Fail-closed SL/TP sur book stale | CODE | ✅ Voir §4.8 |

#### Verdict

Phases **1–5** + follow-ups P2/P3 + ops/produit clos (2026-08-07). Audit global **terminé**.

---

*Fin du plan. Ce fichier doit être mis à jour à chaque étape complétée (voir §0).*