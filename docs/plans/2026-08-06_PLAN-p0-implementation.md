# PLAN P0 — Implémentation des priorités critiques

> **Date de création** : 2026-08-06
> **Dernière révision** : 2026-08-06 — Phase A corrigée (flags branchés, fail-open) ; B.4 reportée en Phase F
> **Périmètre PR P0** : 3 chantiers P0 + filet de tests + feature flags + migration consommateurs RiskConfig (sans suppression legacy)
> **Hors périmètre PR P0** : Phase F — suppression physique du code legacy RiskConfig (ex-B.4)
> **Branche** : `audit/p0-implementation`
> **Commits Phase A** : `6762b85` (filet initial) · `ff24ab0` (flags branchés + fail-open)
> **Plan parent** : [`docs/plans/2026-08-06_PLAN-audit-global-codebase-doc-bugs-fantomes.md`](2026-08-06_PLAN-audit-global-codebase-doc-bugs-fantomes.md)
> **Annexe mitigations** : [`docs/plans/2026-08-06_ANNEXE-risques-mitigations.md`](2026-08-06_ANNEXE-risques-mitigations.md)
> **Règle d'or** : Ce plan est **vivant**. À chaque étape terminée, mettre à jour ce fichier (statut, dates, observations). Voir §0 du plan parent.

---

## 1. Contexte

Le plan d'audit global identifie deux groupes de priorité P0 :

| Groupe | Étapes plan | Constat | Risque |
|--------|-------------|---------|--------|
| **C4 RiskConfig** | 2.1, 4.1, 3.5 | Legacy en transition non terminée (table droppée, code encore présent, ~15 consommateurs) | Double source de vérité → bug fantôme en production |
| **Bugs fantômes crypto-algo** | 4.3, 4.4 | Shutdown race, cache Gamma + re-entry races | Fuite/état corrompu au shutdown ou reconnect |
| **C1 sim/real** (P1 promu P0) | 3.1, 4.2 | Duplication massive sim/real (~10 paires) | Régression silencieuse à chaque correction unilatérale |
| **Filet de tests** (RT) | — | Absence de tests d'arête (boot, shutdown, config absente) | Refactor sans filet = régression non détectée |

L'annexe de mitigations (§R1, §R2, §R4, §RT) propose des stratégies concrètes adaptées à la codebase. Ce plan les opérationnalise.

---

## 2. Zones d'ombre résolues (décisions utilisateur)

> Décisions prises le 2026-08-06 après vérification du code.

| # | Question | Décision | Justification / vérification code |
|---|----------|----------|-----------------------------------|
| Q1 | Stratégie de branching | **1 branche unique + 1 PR consolidée** | Tout le travail P0 sur une seule branche `audit/p0-implementation`. Les phases sont séquentielles sur cette branche (A → B → C → D). Commits atomiques par sous-étape pour faciliter `git bisect`. |
| Q2 | Périmètre C1 sim/real | **Extraction fonctions pures + constantes seulement** | NE PAS créer `ModeSession<Snap,Archive>` — les différences structurelles (algoKind, services différents, entités DB différentes) rendent l'héritage rigide. Extraire `toExitAttemptDto`, `toMoveEventDto`, `buildPositionBreakdown`, `truncateEvents` + constantes `SNAPSHOT_DECISION_MAX_EVENTS` / `SNAPSHOT_DECISION_MAX_JSON_BYTES` dans `core/snapshot/decision-collector-shared.ts`. Ne PAS fusionner les services archive (dépendances différentes : `simulationService` vs `portfolioService`). |
| Q3 | Bugs fantômes 4.3/4.4 | **Audit + correction immédiate si bug trouvé** | Si l'audit 4.3/4.4 révèle un bug (crash, fuite, état corrompu), le corriger dans la même PR. Documenter le scénario dans le commit. |
| Q4 | Tests d'arête | **Créer from scratch en première étape** | Aucun test existant ne couvre les arêtes de transition (boot sans config, shutdown mid-eval, divergence RiskConfig, parity sim/real). À créer avant tout refactor. |
| Q5 | Feature flags | **Via SystemConfig (DB)** | Vérification : `SystemConfig` (table `system_config`, clé/valeur) existe avec `getBoolean()`, `getNumber()`, cache 10s, et `seedDefaults()`. Les 3 flags ne sont pas encore présents → les ajouter au seed `system-config-defaults.ts` et les lire via `SystemConfigService.getBoolean()`. Pattern existant du projet : `process.env` pour les secrets, `SystemConfig` pour la config opérationnelle. Les feature flags = config opérationnelle → SystemConfig. |
| Q6 | Compat snapshots DB | **Créer `extractSimConfigSnapshotFromIsolated(global, copy, crypto)` qui retourne le même shape JSON** | Le shape JSON persisté dans `SimulationStateSnapshot.configSnapshot` doit rester identique pour ne pas casser la lecture des snapshots existants. La nouvelle fonction prend les 4 entités isolées et retourne le même type `SimRiskConfigSnapshot`. |
| Q7 | Suppression finale RiskConfig (ex-B.4) | **Hors PR P0 — Phase F / PR séparée** | La suppression de `composeRiskConfig`, `getConfig()`, `RiskConfig.ts`, `risk-config-api.ts`, etc. neutralise le rollback par feature flag. La PR P0 migre tous les consommateurs et garde la façade legacy + le guard `assertNoDivergence` en production. La Phase F n'est mergeable qu'après période d'observation (logs propres, `feature.risk_config_strict` testé en pré-prod). |
| Q8 | Correctifs post-audit Phase A | **1A + 2A + 3A** | (1A) `legacy_facade=false` → `getConfig`/`updateConfig` throw ; vrai gate Strangler. Guard compose reste léger. Lecture flags fail-open. (2A) `deprecated_fallbacks_enabled=false` → throw sur Gamma TTL sans cryptoConfig. (3A) renforcer tests StrategyRunner/Redis sans extraire le shutdown de `index.ts` (extract = Phase D si besoin). |

---

## 3. Feature flags (SystemConfig) — **branchés** ✅

Entrées seedées dans `packages/core/src/seed/system-config-defaults.ts` et lues via `getFeatureFlag()` / `SystemConfigService.getFeatureFlag()` :

| Clé | Default | Category | Comportement runtime |
|-----|---------|----------|----------------------|
| `feature.risk_config_legacy_facade` | `true` | `feature_flag` | `true` → `RiskService.getConfig()` / `updateConfig()` autorisés. `false` → throw `RiskConfigLegacyFacadeDisabledError` (force getters isolés). Lecture échouée → **fail-open** (`true`). |
| `feature.risk_config_strict` | `false` | `feature_flag` | Guard compose `assertNoDivergence` : `false` = log-only, `true` = throw. Lecture échouée → **fail-open** (`false` / log-only). Check léger (spread compose) — le vrai gate Strangler est `legacy_facade`. |
| `feature.deprecated_fallbacks_enabled` | `true` | `feature_flag` | Lu au boot / config-changed dans crypto-algo → `StrategyRunner.setDeprecatedFallbacksEnabled`. `false` → `resolveGammaCacheTtlOrFallback` throw si cryptoConfig absent. Lecture échouée → **fail-open** (`true`). |

**Lecture** : `getFeatureFlag(ds, 'risk_config_legacy_facade', true)` (préfixe `feature.` ajouté automatiquement).

**Rollback C4 (PR P0)** : `UPDATE system_config SET value = 'true' WHERE key = 'feature.risk_config_legacy_facade'` (cache TTL 10s) → réautorise la façade legacy tant que Phase F non mergée.

---

## 4. Stratégie de branching — PR unique

```
main (stable)
 └─ audit/p0-implementation   (branche unique — toutes les phases A→B→C→D séquentielles)
     └─ merge → main (1 PR consolidée)
```

**Règles** :
- **1 branche** `audit/p0-implementation` pour tout le travail P0.
- **1 PR consolidée** mergeant toutes les phases ensemble.
- Les phases sont **séquentielles** sur la branche : A (préparation) → B (C4 RiskConfig) → C (C1 sim/real) → D (bugs fantômes).
- **Commits atomiques** : 1 sous-étape = 1 commit (ex: 1 migration de consommateur RiskConfig = 1 commit). Facilite `git bisect` si une régression apparaît après merge.
- **Tag** : `p0-complete` après merge de la PR P0 (sans Phase F).
- **Phase F** : branche et PR séparées (`audit/p0-riskconfig-purge`), mergeable uniquement après critères §6 (observation + validation pré-prod).
- **Ordre d'exécution strict** : les tests d'arête (Phase A) doivent être commits ET verts sur la branche avant que les phases B/C/D ne commencent. Le filet doit exister dans le code avant le saut.

---

## 5. Todolist détaillée

### Phase A — Préparation

> **Objectif** : créer le filet de tests d'arête, installer les guards, cartographier les consommateurs, seed les feature flags.
> **Réf annexe** : §RT (tests), §R1 étape 2 (guard divergence), §R3 étape 1 (log.warn fallbacks).
> **Ordre** : cette phase doit être commitée et verte AVANT que les phases B/C/D ne commencent.

#### A.1 — Feature flags seed

- [x] Ajouter 3 entrées `feature.*` au seed `packages/core/src/seed/system-config-defaults.ts` ✅ 2026-08-06
- [x] Ajouter un helper `getFeatureFlag(ds, key, fallback)` dans `core/services/system-config.service.ts` (wrapping `getBoolean` avec préfixe `feature.`) ✅ 2026-08-06
- [x] Vérifier que `seedDefaults()` est appelé au boot (grep `seedDefaults`) ✅ 2026-08-06 — `packages/backend/src/index.ts`, `packages/core/src/seed/defaults.ts`
- [x] **Observations** : flags seedés via `seedSystemConfigDefaults`. Correctif post-audit : `risk_config_legacy_facade=false` fait throw `getConfig`/`updateConfig` ; lecture flag fail-open ; `deprecated_fallbacks_enabled` branché dans StrategyRunner.

#### A.2 — Tests d'arête C4 (RiskConfig divergence)

- [x] Créer `packages/core/src/risk/risk-config-divergence.test.ts` ✅ 2026-08-06
- [x] Vérifier que le test passe en mode log-only (default) ✅ 2026-08-06
- [x] **Observations** : guard extrait dans `risk-config-divergence.ts`. Sémantique documentée : check compose léger ; vrai gate Strangler = `feature.risk_config_legacy_facade`.

#### A.3 — Tests d'arête C1 (parity sim/real)

- [x] Créer `packages/core/src/simulation/snapshot-decision-collector-parity.test.ts` ✅ 2026-08-06
- [x] Créer `packages/core/src/services/sim-real-archive-parity.test.ts` ✅ 2026-08-06
- [x] **Observations** : real archive requiert `observedCash` pour éviter equity NaN.

#### A.4 — Tests d'arête bugs fantômes (crypto-algo)

- [x] Créer `packages/crypto-algo/src/crypto-algo-shutdown.test.ts` ✅ 2026-08-06
- [x] Créer `packages/crypto-algo/src/strategy/strategy-runner-config-race.test.ts` ✅ 2026-08-06
- [x] **Observations** : re-entry Redis = fail-closed (`shouldFailClosedOnReentryRedisLoad`). Tests renforcés (config atomique, fallbacks throw). **Hors scope 3A** : extract du vrai `shutdown` de `index.ts` → Phase D si audit le justifie. Code utilise `evalChains` (pas flag `evaluating`).

#### A.5 — Guard de divergence RiskConfig

- [x] Ajouter `assertNoDivergence()` dans `risk.service.ts` après `composeRiskConfig` ✅ 2026-08-06
- [x] Vérifier que le guard ne casse pas les tests existants ✅ 2026-08-06
- [x] **Observations** : lit `feature.risk_config_strict` via `readFeatureFlagSafe` (fail-open). Sémantique = intégrité compose ; gate Strangler = `legacy_facade`.

#### A.6 — Log.warn temporaire sur les fallbacks deprecated (C9 préparation)

- [x] Ajouter `log.warn` dans `resolveGammaCacheTtlOrFallback` (ex-`gammaCacheTtlFallback`) ✅ 2026-08-06
- [x] Ajouter `log.warn` dans `StrategyRunner.start()` si `currentCryptoConfig` est null ✅ 2026-08-06
- [x] **Observations** : `deprecated_fallbacks_enabled=false` → throw. Flag refreshé via `applyCryptoAlgoRiskTunables` (boot + config-changed).

#### A.7 — Cartographie exhaustive des consommateurs RiskConfig

- [x] Produire `docs/plans/riskconfig-consumer-matrix.md` ✅ 2026-08-06
- [x] Classifier par criticité (hot path vs cold path) ✅ 2026-08-06
- [x] **Observations** :

#### A.8 — Vérifier baseline tests existants

- [x] Lancer `npm run test -w @polywatch/core` — 9 échecs préexistants hors périmètre Phase A (704 pass) ✅ 2026-08-06
- [x] Lancer `npm run test -w @polywatch/crypto-algo` — nouveaux tests verts ✅ 2026-08-06
- [ ] Lancer `npm run test:e2e:crypto` — non exécuté (long, à faire avant merge PR)
- [x] **Observations** : baseline ~713 tests core, 8 nouveaux tests Phase A verts.

#### A.9 — Commit de la Phase A

- [x] Vérifier que tous les tests d'arête (A.2, A.3, A.4) sont verts ✅ 2026-08-06
- [x] Vérifier que le guard (A.5) ne casse pas les tests existants ✅ 2026-08-06
- [x] `npm run build` core + crypto-algo doit passer ✅ 2026-08-06
- [x] Commit initial : `6762b85` `feat(p0): Phase A — edge tests, guards, and feature flags` ✅ 2026-08-06
- [x] Commit correctif : `ff24ab0` `fix(p0): wire feature flags and fail-open RiskConfig guards` ✅ 2026-08-06
- [x] **Observations** : Phase A complète et prête pour Phase B. e2e crypto encore à lancer avant merge PR (A.8).

---

### Phase B — C4 RiskConfig Strangler Fig (migration consommateurs)

> **Objectif** : migrer les ~15 consommateurs de `RiskConfig` vers les 4 tables isolées, un par un. **Conserver** la façade legacy (`composeRiskConfig`, `getConfig`, entité `RiskConfig.ts`) — la suppression physique est reportée en Phase F.
> **Réf annexe** : §R1 (stratégie complète, étapes 1-3 ; étape 4 = Phase F).
> **Prérequis** : Phase A commitée et verte sur la branche.

#### B.1 — Migration consommateurs 1-4 (moins risqués)

- [ ] `sim-execution-tunables.ts` → `GlobalConfig` (champs sim exec latency/self-impact dans GlobalConfig). Test existant : `sim-execution-tunables.test.ts`.
- [ ] `sim-rotation-targets.ts` → `CopyConfig` + `CryptoConfig`
- [ ] `crypto-algo-exit.ts` → `CryptoConfig`
- [ ] `reservation.service.ts` → wrapper `getCopyMaxOpenPositions` / `getCryptoMaxOpenPositions` selon algoKind
- [ ] Après chaque migration : `npm run build -w @polywatch/core` doit passer (TypeScript empêche les références mortes)
- [ ] Après chaque migration : `npm run test -w @polywatch/core` doit être vert
- [ ] **Observations** :

#### B.2 — Migration consommateurs 5-6 (délicats : snapshots + sessions)

- [ ] Créer `extractSimConfigSnapshotFromIsolated(global: GlobalConfig, copy: CopyConfig, crypto: CryptoConfig): SimRiskConfigSnapshot` dans `sim-mode-fields.ts` (retourne le même shape JSON pour compat snapshot DB)
- [ ] Créer `extractRealConfigSnapshotFromIsolated(global: GlobalConfig, copy: CopyConfig, crypto: CryptoConfig): RealConfigSnapshot` (même approche)
- [ ] Migrer `simulation-archive.service.ts` → utiliser `extractSimConfigSnapshotFromIsolated` au lieu de `extractSimConfigSnapshot(getConfig())`
- [ ] Migrer `real-archive.service.ts` → utiliser `extractRealConfigSnapshotFromIsolated`
- [ ] Créer `SIM_SESSION_ROTATION_KEYS_ISOLATED` et `REAL_SESSION_ROTATION_KEYS_ISOLATED` typés sur `CopyConfig | CryptoConfig | GlobalConfig` (au lieu de `keyof RiskConfig`)
- [ ] Migrer `simulation-session.service.ts` → `pickRotationKeys` avec les nouvelles keys
- [ ] Migrer `real-session.service.ts` → `pickRotationKeys` avec les nouvelles keys
- [ ] Créer `pickRotationKeysFromIsolated(global, copy, crypto, keys): string` qui remplace `pickRotationKeys(config: RiskConfig, keys)`
- [ ] Créer `realRotationChangedFromIsolated(before, after): boolean` qui remplace `realRotationChanged(before: RiskConfig, after: RiskConfig)`
- [ ] Tests : `sim-mode-fields.test.ts` et `risk-config-api.test.ts` doivent passer sur les nouveaux types
- [ ] **Observations** :

#### B.3 — Migration consommateurs 7-8

- [ ] `weather-algo/strategy-runner.ts` → vérifier que l'import `RiskConfig` est type-only, le supprimer
- [ ] `close-bid.ts` (worker) → wrapper algo-kind
- [ ] **Observations** :

#### B.4 — Vérification pré-suppression (sans suppression de code)

- [ ] Vérifier via la matrice A.7 que tous les consommateurs **runtime** et **facade** ciblés par B.1–B.3 sont migrés (reste autorisé : imports `type` only, façade legacy elle-même, API backend/frontend — Phase F)
- [ ] Test d'intégration ou script : `feature.risk_config_legacy_facade = false` en environnement de test → aucun crash sur les hot paths migrés (la façade reste dans le code, le flag simule le comportement post-Phase-F)
- [ ] Documenter dans la matrice les entrées restantes pour Phase F (`backend/routes/config.ts`, types frontend, etc.)
- [ ] **Ne pas** supprimer `composeRiskConfig`, `getConfig()`, `RiskConfig.ts`, `risk-config-api.ts`, ni `assertNoDivergence`
- [ ] **Observations** :

#### B.5 — Commit de la Phase B

- [ ] Vérifier que tous les tests (A + B) sont verts
- [ ] `npm run build` complet doit passer
- [ ] Commit : `refactor(p0): Phase B — C4 RiskConfig consumer migration (legacy facade retained)`
- [ ] **Observations** :

---

### Phase C — C1 sim/real extraction

> **Objectif** : extraire les fonctions pures partagées et les constantes dupliquées vers `decision-collector-shared.ts`.
> **Réf annexe** : §R2 (stratégie complète).
> **Prérequis** : Phase B commitée et verte sur la branche.
> **Périmètre** : extraction fonctions pures + constantes SEULEMENT. NE PAS fusionner les services archive.

#### C.1 — Extraire decision-collector-shared.ts

- [ ] Créer `packages/core/src/snapshot/decision-collector-shared.ts` :
  - `toExitAttemptDto` (identique, sim:54-69 = real:53-68)
  - `toMoveEventDto` (identique, sim:71-91 = real:70-90)
  - `incrementCount` (identique)
  - `buildPositionBreakdown` (identique, sim:97-122 = real:96-121)
  - `truncateEvents` (identique, sim:157-162 = real:153-158)
  - Constantes `SNAPSHOT_DECISION_MAX_EVENTS = 500` et `SNAPSHOT_DECISION_MAX_JSON_BYTES = 2_000_000`
- [ ] **Observations** :

#### C.2 — Refactor simulation/snapshot-decision-collector.ts

- [ ] Importer les fonctions et constantes depuis `decision-collector-shared.ts`
- [ ] Supprimer les définitions locales dupliquées
- [ ] Garder les parties spécifiques (algoKind, filtre watchlist sim, query SimulationStateSnapshot)
- [ ] `npm run test -w @polywatch/core` doit être vert
- [ ] **Observations** :

#### C.3 — Refactor real/snapshot-decision-collector.ts

- [ ] Importer les fonctions et constantes depuis `decision-collector-shared.ts`
- [ ] Supprimer les définitions locales dupliquées
- [ ] Garder les parties spécifiques (pas d'algoKind, filtre watchlist real, query RealStateSnapshot)
- [ ] `npm run test -w @polywatch/core` doit être vert
- [ ] Le test de parity (A.3) doit être vert
- [ ] **Observations** :

#### C.4 — Ajouter le script de diff CI

- [ ] Créer `tools/diff-sim-real-snapshot.ts` qui compare les deux fichiers `snapshot-decision-collector.ts` et alerte si un fix appliqué d'un côté n'est pas de l'autre
- [ ] Documenter la convention de commit : `fix(sim): ... [mirror: real/snapshot-decision-collector.ts]`
- [ ] **Observations** :

#### C.5 — Commit de la Phase C

- [ ] Vérifier que tous les tests (A + B + C) sont verts
- [ ] `npm run build` complet doit passer
- [ ] Commit : `refactor(p0): Phase C — C1 sim/real extraction fonctions pures + constantes`
- [ ] **Observations** :

---

### Phase D — Bugs fantômes 4.3/4.4

> **Objectif** : auditer les scénarios de shutdown et de races, corriger immédiatement les bugs trouvés.
> **Réf plan** : §4.3 (crypto-algo shutdown), §4.4 (strategy-runner races).
> **Réf annexe** : §R4 (invariant d'atomicité du cache).
> **Prérequis** : Phase C commitée et verte sur la branche.

#### D.1 — Audit 4.3 : crypto-algo/index.ts shutdown

- [ ] Scénario SIGTERM pendant `evaluateSelection` : `evaluating` flag est-il reset ? Le timer re-entrance est-il bloqué ?
- [ ] Scénario SIGTERM pendant `runAlgoEntryPipeline` : réservation libérée ? Queue en cours ACK ?
- [ ] Vérifier l'ordre de shutdown (timers, Redis, DS) — une erreur dans l'un empêche-t-elle les suivants ?
- [ ] Si bug trouvé : **corriger immédiatement** dans la même branche
- [ ] **Observations** :

#### D.2 — Audit 4.4 : strategy-runner cache Gamma + re-entry

- [ ] Scénario Redis down : `re-entry throttle` fail-closed (bloque) ou fail-open (autorise) ? Doc dit "fail-closed" — vérifier le code
- [ ] Scénario WS reconnect : `midHistoryBuffer` est-il invalidé ? Le cache Gamma stale-on-error reste-t-il trop longtemps ?
- [ ] Scénario `config-changed` pendant évaluation : le cache `currentCryptoConfig` est-il invalidé atomiquement ?
- [ ] Scénario `gammaCacheTtlFallback` : si `cryptoConfig` absent, le fallback local diverge-t-il du `resolveGammaCacheTtlMs` core ?
- [ ] Si bug trouvé : **corriger immédiatement** dans la même branche
- [ ] Si correction du cache : préserver l'invariant d'atomicité (passer `cryptoConfig` en paramètre aux reads du cache, pas lire depuis `currentCryptoConfig`)
- [ ] **Observations** :

#### D.3 — Tests de non-régression

- [ ] Le test de shutdown (A.4) doit être vert après corrections
- [ ] Le test de config-race (A.4) doit être vert après corrections
- [ ] `npm run test:e2e:crypto` doit être vert
- [ ] **Observations** :

#### D.4 — Commit de la Phase D

- [ ] Vérifier que tous les tests (A + B + C + D) sont verts
- [ ] `npm run build` complet doit passer
- [ ] `npm run lint` doit passer
- [ ] Commit : `fix(p0): Phase D — bugs fantômes 4.3/4.4 audit + corrections`
- [ ] **Observations** :

---

### Phase F — Suppression finale RiskConfig (PR séparée — hors P0)

> **Objectif** : supprimer physiquement le code legacy RiskConfig une fois la migration B.1–B.3 validée en production.
> **Réf annexe** : §R1 étape 4.
> **Prérequis** (tous requis avant de démarrer Phase F) :
> - PR P0 mergée et stable en production
> - ≥ 1 semaine de logs propres avec `assertNoDivergence` actif (`feature.risk_config_strict = false`)
> - `feature.risk_config_strict = true` validé en pré-prod sans divergence
> - B.4 validé : `feature.risk_config_legacy_facade = false` en staging sans crash
> - Branche dédiée : `audit/p0-riskconfig-purge` → PR séparée vers `main`

#### F.1 — Préparation API backend + frontend

- [ ] Créer `presentIsolatedConfigForApi` (présente les 4 tables séparément) — remplace `presentRiskConfigForApi`
- [ ] Migrer `packages/backend/src/routes/config.ts` vers la nouvelle API
- [ ] Migrer les consommateurs frontend (`snapshot-config-diff.ts`, `simulation-snapshots.ts`, `real-snapshots.ts`, `sim-execution-settings-types.ts`, etc.)
- [ ] `npm run build` complet (core + backend + frontend) doit passer
- [ ] **Observations** :

#### F.2 — Suppression code legacy

- [ ] Passer `feature.risk_config_legacy_facade = false` en staging — smoke test complet
- [ ] Supprimer `composeRiskConfig()` et `getConfig()` legacy de `risk.service.ts` (garder `getGlobalConfig`, `getCopyConfig`, `getCryptoConfig`, `getWeatherConfig`, `getConfigForAlgo`)
- [ ] Supprimer les getters legacy de `policy.ts` (lignes ~49-349 : `getModeSizingParams`, `getModeExitParams`, `getModeMaxOpenPositions`, `pickModeValue`, etc.)
- [ ] Supprimer `risk-config-api.ts` (`presentRiskConfigForApi`, `toRiskConfigEntityUpdate`, `RiskConfigApi` type)
- [ ] Supprimer `sim-mode-fields.ts` legacy (garder les équivalents isolés créés en B.2)
- [ ] Retirer `RiskConfig` de `entities/index.ts` et `data-source.ts`
- [ ] Supprimer `entities/RiskConfig.ts`
- [ ] Supprimer le guard `assertNoDivergence` et retirer `feature.risk_config_strict` du seed (ou le laisser inactif — documenter)
- [ ] Retirer `feature.risk_config_legacy_facade` du seed (code mort)
- [ ] **Observations** :

#### F.3 — Vérification et PR

- [ ] `npm run build` complet doit passer
- [ ] `npm run test` complet doit être vert
- [ ] `npm run lint` doit passer
- [ ] Vérifier que `entities/RiskConfig.ts` est supprimé (grep → 0 import runtime)
- [ ] PR : `P0.1 — RiskConfig legacy purge`
- [ ] Tag : `p0-riskconfig-purge` après merge
- [ ] **Observations** :

---

### Phase E — Finalisation et PR

> **Objectif** : vérifier l'intégrité globale, créer la PR consolidée.

#### E.1 — Vérification finale

- [ ] `npm run build` complet (tous les packages) doit passer
- [ ] `npm run test` complet (tous les packages) doit être vert
- [ ] `npm run lint` doit passer
- [ ] `npm run test:e2e:crypto` doit être vert
- [ ] Vérifier que les feature flags sont bien seedés (grep `feature.risk_config` dans `system-config-defaults.ts`)
- [ ] Vérifier que `entities/RiskConfig.ts` **existe encore** (façade legacy conservée — suppression = Phase F)
- [ ] Vérifier que `assertNoDivergence` est actif dans `risk.service.ts`
- [ ] Vérifier que la matrice `riskconfig-consumer-matrix.md` liste les entrées restantes pour Phase F
- [ ] Vérifier que `decision-collector-shared.ts` existe et est importé par les deux collecteurs
- [ ] **Observations** :

#### E.2 — Création de la PR

- [ ] Créer la PR depuis `audit/p0-implementation` vers `main`
- [ ] Titre : `P0 — RiskConfig migration + sim/real extraction + bugs fantômes crypto-algo`
- [ ] Body : résumé des phases A/B/C/D, **expliciter que la suppression legacy RiskConfig est reportée en Phase F (PR séparée)**, liste des commits atomiques, feature flags introduits, tests d'arête créés
- [ ] Tag : `p0-complete` après merge (Phase F = tag `p0-riskconfig-purge` séparé)
- [ ] **Observations** :

---

## 6. Garde-fous transversaux

### Avant chaque phase de refactor

| Phase | Garde-fou |
|-------|-----------|
| Phase B (C4) | Tests d'arête A.2 verts + `npm run test -w @polywatch/core` vert |
| Phase C (C1) | Tests d'arête A.3 verts + `npm run test -w @polywatch/core` vert |
| Phase D (bugs) | Tests d'arête A.4 verts + `npm run test -w @polywatch/crypto-algo` vert |

### Après chaque commit de refactor

- Relancer les tests du package touché
- `npm run build` complet doit passer
- `npm run lint` doit passer

### Feature flags de sécurité

| Flag | Default | Quand passer à `false` / `true` | Rollback | État code |
|------|---------|--------------------------------|----------|-----------|
| `feature.risk_config_legacy_facade` | `true` | Staging Phase F : passer à `false` pour valider que plus aucun hot path n'appelle `getConfig` | `UPDATE … SET value='true'` | ✅ Branché (`RiskService`) |
| `feature.risk_config_strict` | `false` | 1 semaine post-merge PR P0 sans warn compose → `true` en pré-prod, avant Phase F | `UPDATE … SET value='false'` | ✅ Branché (fail-open si illisible) |
| `feature.deprecated_fallbacks_enabled` | `true` | Après D.2 (si fallback confirmé inutile) → `false` | `UPDATE … SET value='true'` | ✅ Branché (`StrategyRunner`) |

### Règle d'or

> **Aucun refactor critique (C4, C1, bugs fantômes) ne commence avant que les tests d'arête correspondants (Phase A) soient commités et verts sur la branche.** Le test est le filet ; le refactor est le saut. On ne saute pas sans filet.

---

## 7. Rollback global

| Scénario | Action |
|----------|--------|
| PR P0 entière casse la production | `git revert` la PR consolidée → retour à l'état pré-P0 |
| C4 migration casse (PR P0, façade encore présente) | `feature.risk_config_legacy_facade = true` (SystemConfig, cache TTL 10s) → `getConfig`/`updateConfig` réautorisés sans revert |
| Phase F casse après purge | `git revert` PR Phase F — **ou** restaurer la façade depuis le tag `p0-complete` si revert insuffisant |
| Feature flag illisible (DB) | Fail-open automatique : façade legacy reste autorisée ; strict reste log-only ; fallbacks deprecated restent actifs |
| Feature flag casse | `UPDATE system_config SET value = '<default>' WHERE key = 'feature.*'` |

> Note : en conservant la façade legacy dans la PR P0, le rollback C4 par feature flag est **effectif** (`false` throw, `true` réautorise). La Phase F reintroduit un rollback principalement via `git revert` (le flag n'a plus de code à piloter après purge).

---

## 8. Statut global

| Phase | Statut | Dernière mise à jour |
|-------|--------|----------------------|
| Phase A — Préparation (tests + guards + cartographie) | ✅ Terminée (+ correctif flags) | 2026-08-06 |
| Phase B — C4 RiskConfig migration consommateurs | ⏳ En attente | — |
| Phase C — C1 sim/real extraction | ⏳ En attente | — |
| Phase D — Bugs fantômes 4.3/4.4 | ⏳ En attente | — |
| Phase E — Finalisation et PR P0 | ⏳ En attente | — |
| Phase F — Suppression finale RiskConfig (PR séparée) | ⏸️ Reportée | 2026-08-06 |

---

*Fin du plan P0. Ce fichier doit être mis à jour à chaque étape complétée (voir §0 du plan parent).*