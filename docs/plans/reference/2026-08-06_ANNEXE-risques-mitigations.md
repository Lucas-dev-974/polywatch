z# ANNEXE — Risques et mitigations du plan d'audit

> **Date de création** : 2026-08-06
> **Dernière resync** : 2026-08-07 — C9 fallbacks purgés (`6d99017`) ; SL/TP fail-closed 30s
> **Périmètre** : Monorepo Polywatch-v1.1
> **Document parent** : [`docs/plans/applied/2026-08-06_PLAN-audit-global-codebase-doc-bugs-fantomes.md`](../applied/2026-08-06_PLAN-audit-global-codebase-doc-bugs-fantomes.md)
> **Objectif** : Pour chacun des 9 risques identifiés (+ 1 risque transversal tests), proposer des mitigations concrètes, adaptées à la codebase réelle, avec garde-fous, plan de rollback et séquencement.

---

## Synthèse exécutive

Le plan touche 3 zones critiques à double source de vérité (RiskConfig legacy, duplication sim/real, ~~constantes deprecated en fallback~~ **C9 clos**) et 3 zones de refactor structurel (god-objects, post-entry-mid-logger, abstraction crypto/weather). La mitigation repose sur 4 principes :

1. **Strangler Fig pattern** — ne jamais big-bang ; migrer consommateur par consommateur.
2. **Double source of truth → single source via garde d'assertion** — ajouter un guard runtime qui détecte la divergence avant qu'elle produise un bug fantôme.
3. **Feature flags env** — chaque refactor critique est gated par une var d'env permettant rollback instantané sans redeploiement complet.
4. **Test safety net prioritaire** — construire les tests d'arêtes (boot, shutdown, config absente) avant tout refactor, pas après.

### Tableau récapitulatif des risques

| # | Risque | Sévérité | Stratégie de mitigation | Réf annexe |
|---|--------|----------|-------------------------|------------|
| 1 | C4 : Purge RiskConfig legacy | 🔴 P0 | Strangler Fig + guard de divergence | §R1 |
| 2 | C1 : Refactor duplication sim/real | 🔴 P0 | Généricité par composition (fonctions pures partagées) | §R2 |
| 3 | C9 : Purge deprecated constants en fallback | ~~🟢 P3~~ → ✅ clos | Éliminer le fallback en garantissant la config au boot | §R3 |
| 4 | C6 : Refactor god-objects | 🟡 P2 | Extraction conservatrice avec invariant d'atomicité | §R4 |
| 5 | C10 : Finish post-entry-mid-logger | 🟡 P1 | Entité + migration + cancellation par position | §R5 |
| 6 | C8 : Abstract crypto-algo ↔ weather-algo | 🟡 P2 | NE PAS abstraire — documenter et converger par copie consciente | §R6 |
| 7 | Process discipline (plan manuel) | 🟢 P3 | Automatisation légère | §R7 |
| 8 | C5 : Centralize Polymarket | 🟢 P2 | Move + re-export shim | §R8 |
| 9 | C12 : Update api.md | 🟡 P1 | Ajouter routes manquantes + script coverage CI | §R9 |
| T | Risque transversal — No test safety net | 🔴 P0 | Filet de tests ciblé avant refactor | §RT |

---

## R1 — C4 : Purge RiskConfig legacy (P0)

### Contexte précis

- `packages/core/src/entities/RiskConfig.ts` (770 lignes) — table `risk_config` déjà DROP par migration 0088 (`DropLegacyRiskConfig1700000000088.ts:7`), mais l'entité TypeORM est encore enregistrée dans `data-source.ts:221` et exportée dans `entities/index.ts:4`.
- `packages/core/src/services/risk.service.ts:56` — `getConfig()` compose un faux `RiskConfig` à partir des 4 tables isolées (`composeRiskConfig`, ligne 258) via spread `{...global, ...copy, ...crypto, ...weather, id: 0}`. **C'est une façade de rétro-compat.**
- `packages/core/src/risk/policy.ts` — contient ~20 getters legacy (`getModeSizingParams:51`, `getModeMaxOpenPositions:120`, `pickModeValue:110`) qui prennent `RiskConfig` en paramètre, **en parallèle** des wrappers algo-kind (`getCopyMaxOpenPositions:439`, `getCryptoMaxOpenPositions:613`, `getWeatherMaxOpenPositions:683`).
- ~15 fichiers consommateurs encore actifs (grep `RiskConfig` = 67 fichiers, mais ~15 consommateurs runtime réels hors migrations/tests/types).
- **Le risque concret** : `composeRiskConfig` fait un spread aveugle — si deux tables définissent le même champ (ex: `simInitialCapital` existe dans `GlobalConfig` ET `CopyConfig` via `simInitialCapitalCopy`), le dernier spread gagne silencieusement. Ordre actuel: `global → copy → crypto → weather`. Un renommage de champ pourrait casser ça sans warning.

### Stratégie de mitigation : Strangler Fig + guard de divergence

**Étape 1 — Cartographie exhaustive des consommateurs (avant tout edit)**

Produire un fichier `docs/plans/riskconfig-consumer-matrix.md` listant chaque import de `RiskConfig` avec :
- fichier:ligne
- usage type : `type` (import type only) | `runtime` (appel getter legacy) | `facade` (via `risk.service.ts getConfig`)
- valeur lue : quel champ précis
- remplacement cible : quel wrapper algo-kind

Pour les ~15 consommateurs runtime, classifier par criticité :
- **Critiques (runtime, hot path)** : `reservation.service.ts`, `simulation-archive.service.ts`, `real-archive.service.ts`, `simulation-session.service.ts`, `real-session.service.ts`, `weather-algo/strategy-runner.ts`, `weather-algo/processors/weather-exit-evaluator.ts`, `worker/processors/strategy/close-bid.ts`, `core/risk/crypto-algo-exit.ts`, `core/risk/sim-execution-tunables.ts`, `core/risk/sim-rotation-targets.ts`
- **Non-critiques** : migrations (0087, 0090 — historiques, ne pas toucher), tests, types snapshot, frontend (lib/simulation-snapshots.ts, lib/real-snapshots.ts — lecture only), backend routes (config.ts, config-per-kind.ts — API surface).

**Étape 2 — Guard de divergence (à installer AVANT la migration)**

Ajouter dans `risk.service.ts` un guard runtime qui détecte la double source de vérité :

```typescript
// risk.service.ts — ajouter après composeRiskConfig
private assertNoDivergence(composed: RiskConfig, global: GlobalConfig, copy: CopyConfig, crypto: CryptoConfig, weather: WeatherConfig): void {
  // Vérifier que les champs legacy RiskConfig ne divergent pas des tables isolées
  const divergences: string[] = [];
  if (composed.simMaxOpenPositions !== copy.simMaxOpenPositions) divergences.push('simMaxOpenPositions');
  if (composed.cryptoAlgoEnabled !== crypto.cryptoAlgoEnabled) divergences.push('cryptoAlgoEnabled');
  // ... pour chaque champ critique
  if (divergences.length > 0 && process.env.RISK_CONFIG_STRICT === '1') {
    log.error({ divergences }, 'RiskConfig facade divergence detected — blocking');
    throw new Error(`risk_config_divergence: ${divergences.join(',')}`);
  } else if (divergences.length > 0) {
    log.warn({ divergences }, 'RiskConfig facade divergence detected — non-blocking');
  }
}
```

Ce guard log-only par défaut, fail-closed si `RISK_CONFIG_STRICT=1`. Permet de détecter en production avant le refactor.

**Étape 3 — Migration consommateur par consommateur (Strangler Fig)**

Pour chaque consommateur runtime critique, dans cet ordre (du moins risqué au plus risqué) :

1. **`sim-execution-tunables.ts`** — passe de `RiskConfig` à `GlobalConfig` (champs sim exec latency/self-impact sont dans GlobalConfig). Test : `sim-execution-tunables.test.ts` existe déjà.
2. **`sim-rotation-targets.ts`** — passe à `CopyConfig` + `CryptoConfig`.
3. **`crypto-algo-exit.ts`** — passe à `CryptoConfig`.
4. **`reservation.service.ts`** — passe au wrapper `getCopyMaxOpenPositions` / `getCryptoMaxOpenPositions` selon algoKind.
5. **`simulation-archive.service.ts` / `real-archive.service.ts`** — passe à `extractSimConfigSnapshot`/`extractRealConfigSnapshot` mais avec les types isolés. Le plus délicat car `sim-mode-fields.ts` (`SIM_RISK_CONFIG_KEYS`, `extractSimConfigSnapshot`) est typé sur `RiskConfig`. **Créer `extractSimConfigSnapshotFromIsolated(global, copy, crypto)` qui prend les 4 entités isolées** et retourne le même shape JSON (pour compat snapshot DB).
6. **`simulation-session.service.ts` / `real-session.service.ts`** — utilisent `pickRotationKeys` + `SIM_SESSION_ROTATION_KEYS` (qui sont `keyof RiskConfig[]`). **Migrer vers `SIM_SESSION_ROTATION_KEYS_ISOLATED` typé sur `CopyConfig | CryptoConfig | GlobalConfig`**.
7. **`weather-algo/strategy-runner.ts`** — déjà typé sur `WeatherConfig` via `setRiskConfig(risk: WeatherConfig)`. Vérifier que l'import `RiskConfig` est uniquement type-only et peut être supprimé.
8. **`close-bid.ts` (worker)** — passe au wrapper algo-kind.

**Étape 4 — Suppression finale**

Une fois tous les consommateurs runtime migrés :
- Supprimer `composeRiskConfig()` et `getConfig()` legacy de `risk.service.ts` (garder seulement `getGlobalConfig/getCopyConfig/getCryptoConfig/getWeatherConfig/getConfigForAlgo`).
- Supprimer les getters legacy de `policy.ts` (lignes 49-349 : `getModeSizingParams`, `getModeExitParams`, `getModeMaxOpenPositions`, etc. + `pickModeValue`).
- Supprimer `risk-config-api.ts` (`presentRiskConfigForApi`, `toRiskConfigEntityUpdate`, `RiskConfigApi` type) — remplacer par `presentIsolatedConfigForApi` qui présente les 4 tables séparément.
- Supprimer `sim-mode-fields.ts` (remplacé par équivalents isolés).
- Retirer `RiskConfig` de `entities/index.ts:4` et `data-source.ts:221`.
- Supprimer `entities/RiskConfig.ts`.

### Garde-fous concrets

1. **Gate de compilation TypeScript** : après chaque migration de consommateur, lancer `npm run build -w @polywatch/core` — si l'import `RiskConfig` casse, le compilateur le signale immédiatement. C'est le filet principal car TypeScript empêche les références mortes.
2. **Guard runtime de divergence** (voir étape 2) — installer avant, garder pendant la migration, retirer à la fin.
3. **Test snapshot** : `sim-mode-fields.test.ts` et `risk-config-api.test.ts` existent — les faire passer sur les nouveaux types isolés avant de supprimer les anciens.
4. **Feature flag** : `RISK_CONFIG_LEGACY_FACADE=1` (default) garde `getConfig()` actif ; `=0` force les consommateurs à utiliser les getters isolés. Permet un rollback instantané.
5. **Vérification DB** : confirmer que migration 0088 est bien jouée en prod (`SELECT table_name FROM information_schema.tables WHERE table_name = 'risk_config'` doit retourner 0 ligne). Si la table existe encore, NE PAS supprimer l'entité.

### Plan de rollback

- **Rollback immédiat** : `RISK_CONFIG_LEGACY_FACADE=1` réactive la façade. Aucun redeploiement de DB nécessaire (la table est déjà droppée — la façade compose depuis les 4 tables, pas depuis `risk_config`).
- **Rollback code** : `git revert` le commit de suppression. Les consommateurs migrés retombent sur la façade `getConfig()` qui existe toujours dans la version précédente.
- **Rollback DB** : migration 0088 `down()` recrée `risk_config` vide — mais inutile car la façade ne lit pas la table.

### Séquencement recommandé

```
Semaine 1 : Étape 1 (cartographie) + Étape 2 (guard divergence) + tests existants verts
Semaine 2 : Étape 3 consommateurs 1-4 (sim-exec, sim-rotation, crypto-exit, reservation)
Semaine 3 : Étape 3 consommateurs 5-6 (archive sim/real, session sim/real) — les plus délicats
Semaine 4 : Étape 3 consommateurs 7-8 (weather, close-bid) + étape 4 suppression
```

---

## R2 — C1 : Refactor duplication sim/real (P0)

### Contexte précis

- `simulation/snapshot-decision-collector.ts` (271 lignes) ↔ `real/snapshot-decision-collector.ts` (259 lignes) : quasi-identiques, différences :
  - Sim a param `algoKind: SimAlgoKind` (ligne 128), filtre `w.simEnabled !== false` (ligne 201), query `SimulationStateSnapshot` avec `algoKind` (ligne 135), `SimulationBalance` (ligne 141).
  - Real n'a pas `algoKind`, filtre `w.realEnabled !== false` (ligne 188), query `RealStateSnapshot` sans filtre (ligne 131), `RealSessionState` `findOne({where:{id:1}})` (ligne 139).
  - Constantes `SNAPSHOT_DECISION_MAX_EVENTS=500` et `SNAPSHOT_DECISION_MAX_JSON_BYTES=2_000_000` dupliquées dans les deux fichiers (sim:12-13, real:11-12).
- `simulation-archive.service.ts` dépend de `SimulationService` + `SimulationSessionService` ; `real-archive.service.ts` dépend de `RealPortfolioService` (services différents, pas interchangeable).

### Stratégie de mitigation : Généricité par composition, pas par héritage

**Principe clé** : NE PAS créer une classe `ModeSession<Snap,Archive>` générique. Les différences structurelles (algoKind, services sous-jacents différents, entités DB différentes) rendent l'héritage rigide. Préférer :

1. **Extraire les fonctions pures partagées** dans `core/snapshot/decision-collector-shared.ts` :
   - `toExitAttemptDto` (identique, sim:54-69 = real:53-68)
   - `toMoveEventDto` (identique, sim:71-91 = real:70-90)
   - `incrementCount` (identique)
   - `buildPositionBreakdown` (identique, sim:97-122 = real:96-121)
   - `truncateEvents` (identique, sim:157-162 = real:153-158)
   - Constantes `SNAPSHOT_DECISION_MAX_EVENTS` et `SNAPSHOT_DECISION_MAX_JSON_BYTES` déplacées UNE FOIS dans le shared, réimportées par les deux fichiers.

2. **Garder les deux collecteurs séparés** mais ils délèguent les fonctions pures au shared. Seules les parties divergentes (query DB, filtre watchlist, algoKind) restent spécifiques. Réduit ~120 lignes de duplication sans risque structurel.

3. **Pour les services archive** : ne PAS fusionner. La divergence de dépendances (`simulationService` vs `portfolioService`) est structurelle. À la place, documenter explicitement le miroir dans `docs/snapshots-simulation.md` et `docs/snapshots-real.md` avec un tableau de correspondance.

### Garde-fous concrets

1. **Test de non-régression par diff** : créer un script `tools/diff-sim-real-snapshot.ts` qui compare les deux fichiers `snapshot-decision-collector.ts` et alerte si un fix appliqué d'un côté n'est pas de l'autre. À lancer en CI ou pre-commit.
2. **Constantes centralisées** : déplacer `SNAPSHOT_DECISION_MAX_EVENTS` dans `decision-collector-shared.ts` — élimine le risque de désynchronisation des constantes.
3. **Tests existants** : vérifier que `simulation-archive.service.ts` a des tests (chercher `simulation-archive.service.test.ts`). Si absent, **ajouter un test smoke** qui crée un snapshot et vérifie le payload de décision avant de toucher au code.
4. **Convention de commit** : tout fix sur un des deux fichiers DOIT mentionner le miroir dans le message de commit (`fix(sim): ... [mirror: real/snapshot-decision-collector.ts]`).

### Plan de rollback

- Le refactor est additif (extraction de fonctions shared) — rollback = `git revert`, les deux fichiers redeviennent autonomes.
- Aucun impact DB, aucun impact runtime.

### Séquencement

```
Étape 1 : Extraire decision-collector-shared.ts + déplacer constantes (1 commit, low-risk)
Étape 2 : Refactor sim/collectSimDecisionPayload pour utiliser shared (1 commit)
Étape 3 : Refactor real/collectRealDecisionPayload pour utiliser shared (1 commit)
Étape 4 : Ajouter tools/diff-sim-real-snapshot.ts en CI
```

---

## R3 — C9 : Purge deprecated constants en fallback — ✅ CLOS (2026-08-07)

> **Commit** : `6d99017` — `fix(audit): disable deprecated gamma fallbacks and fail-closed stale SL/TP`
> **Doc runtime** : [`docs/code/07-crypto-algo.md`](../../code/07-crypto-algo.md) § Cache Gamma

### État final (implémenté)

| Élément | Avant | Après |
|---------|-------|-------|
| TTL Gamma | Constantes locales + `resolveGammaCacheTtlOrFallback` + flag | `resolveGammaCacheTtlMs` / `resolveGammaStaleOnErrorFactor` via `CryptoConfig` uniquement |
| Sans config | Fallback silencieux ou throw (selon flag) | `fetchGammaMarketCached` → `null` + log error (pas de throw dans tick loop) |
| Re-entry window | Export `RE_ENTRY_WINDOW_MS` + ctor default | Ctor `reEntryWindowMs: number \| null = null` ; `0` = bypass e2e ; prod = config |
| Feature flag | `StrategyRunner.setDeprecatedFallbacksEnabled` | Flag seed `false` ; **plus lu** par crypto-algo |
| Boot | `applyRiskTunables` avant `start()` | Inchangé — obligatoire ; log error si absent au `start()` |

**Tests** : `strategy-runner-config-race.test.ts` — `fetchGammaMarketCached` retourne `null` sans `applyRiskTunables`.

### Contexte historique (analyse 2026-08-06, pré-purge)

<details>
<summary>Analyse initiale — chemins de fallback et séquencement P0→P3</summary>

- `strategy-runner.ts` — `RE_ENTRY_WINDOW_MS`, `OUTCOME_PRICES_CACHE_TTL_*`, `gammaCacheTtlFallback` : fallbacks actifs si `currentCryptoConfig` null.
- **Chemin critique** : fenêtre théorique entre constructor et premier `applyRiskTunables` ; en prod le boot appelait déjà `applyCryptoAlgoRiskTunables` avant `start()`.
- **Mitigation retenue** : P0-D flag + warn → observation → purge 2026-08-07 (plan 1A).

Séquencement exécuté :

```
Étape 1 : log.warn sur chemins fallback (P0-D) ✅ 2026-08-06
Étape 2 : flag `deprecated_fallbacks_enabled` branché ✅
Étape 3 : purge fallbacks + TTL via CryptoConfig ✅ 2026-08-07
Étape 4 : seed flag `false`, setter retiré ✅ 2026-08-07
```

</details>

---

## R4 — C6 : Refactor god-objects (P2)

### Contexte précis

- `crypto-algo/strategy/strategy-runner.ts` (951 lignes) : cache Gamma (`gammaCache:125`, `fetchGammaMarketCached:388`, `cleanupGammaCache:433`), re-entry throttle (`reentry:124`, `recordReEntryOnFill:264`, `cleanupReentryState:465`), SL quota (`invalidateSlQuotaCache:255`, `cleanupSlQuotaState:473`), eval loop (`evaluateSelection:535`, `tick:808`), WS wiring (`setPriceFeed:172`, `connectWebSocket:204`, `handlePriceUpdate:486`, `handleMarketResolved:508`).
- `crypto-algo/index.ts` (582 lignes) : wiring manuel de 6 timers (`heartbeatTimer`, `surveillanceRefreshTimer`, `priceTickCleanupTimer`, `positionContextRefreshTimer`, `marketJanitorTimer`, `surveillanceJanitor`), 3 connexions Redis (`redisCmd:100`, `redisPub:101`, `redisSub:102`), 3 pub/sub callbacks (`ALGO_SL_QUOTA_INVALIDATE:428`, `ALGO_REENTRY_FILL:443`, `config-changed:483`).
- Cache invalidation atomique aujourd'hui : `currentCryptoConfig` est set dans `applyRiskTunables:326` qui est appelé dans `evaluateSelectionUnlocked:579` ET dans le handler `config-changed:510`. Si on split le cache dans un sous-module, il faut garantir que l'invalidation reste atomique (pas de fenêtre où le cache est invalidé mais pas encore rechargé).

### Stratégie de mitigation : Extraction conservatrice avec invariant d'atomicité

**Principe** : extraire en sous-modules mais garder l'état mutable dans le `StrategyRunner` (point de coordination). Les sous-modules sont stateless ou possèdent leur propre état isolé.

1. **Extraire `GammaCacheService`** (nouveau fichier `strategy/gamma-cache.ts`) :
   - État : `gammaCache: Map<string, CachedGammaMarket>` (déplacé de StrategyRunner).
   - Méthodes : `fetchCached(conditionId, now, interval, cryptoConfig)`, `cleanup(now)`, `clear(conditionId)`.
   - `StrategyRunner` détient une instance `private readonly gammaCache: GammaCacheService`.
   - **Invariant préservé** : `cryptoConfig` est passé en paramètre à `fetchCached`, pas lu depuis `StrategyRunner.currentCryptoConfig`. Élimine la fenêtre de race.

2. **Extraire `ReEntryThrottleService`** (nouveau fichier `strategy/re-entry-service.ts`) :
   - État : `reentry: Map<string, ReEntryState>` + `redis: Redis | null`.
   - Méthodes : `recordFill(...)`, `isSuppressed(...)`, `cleanup(now)`.
   - `StrategyRunner` délègue `recordReEntryOnFill` et le check dans `evaluateSelectionUnlocked:716`.

3. **NE PAS extraire SL quota** : `sl-quota.ts` existe déjà séparément (`invalidateGlobalSlQuotaCache` est une fonction globale). Le `StrategyRunner` ne fait que déléguer. Pas besoin de plus.

4. **NE PAS extraire l'eval loop** : `evaluateSelection` + `evaluateSelectionUnlocked` + `handlePriceUpdate` sont le cœur métier. Les extraire ajouterait de l'indirection sans bénéfice. Les laisser dans `StrategyRunner` qui devient le coordinator.

5. **Pour `index.ts`** : extraire `CryptoAlgoBootstrap` (nouveau fichier `bootstrap.ts`) qui encapsule la séquence d'init (étapes 1-18 de `main()`). `main()` devient :
   ```typescript
   async function main() {
     const boot = new CryptoAlgoBootstrap(config);
     const { strategyRunner, priceFeed, ... } = await boot.start();
     // shutdown handlers only
   }
   ```
   L'ordre d'init est préservé (waitForBackendReady avant StrategyRunner, etc.) mais encapsulé et testable.

### Garde-fous concrets

1. **Invariant d'atomicité du cache** : test qui vérifie que `applyRiskTunables` + `fetchGammaMarketCached` ne lisent pas une config intermédiaire. Ajouter un test qui appelle `applyRiskTunables(configA)`, lance une eval, appelle `applyRiskTunables(configB)` à mi-chemin, et vérifie qu'une seule config est utilisée par eval.
2. **Test de shutdown** : créer `crypto-algo/src/index.test.ts` (ou `bootstrap.test.ts`) qui mock Redis/DS et vérifie que tous les timers sont cleared dans `shutdown()`.
3. **Build incrementiel** : après extraction de `GammaCacheService`, `npm run build -w @polywatch/crypto-algo` doit passer. Si cassé, rollback immédiat.
4. **Lint** : `npm run lint` après refactor pour détecter les imports circulaires.

### Plan de rollback

- `git revert` commit par commit. Chaque extraction est un commit isolé.
- Les sous-modules sont additifs (nouveaux fichiers) — pas de risque de casser l'existant si on revert.

### Séquencement

```
Étape 1 : Extraire GammaCacheService (1 commit, teste invariant cache)
Étape 2 : Extraire ReEntryThrottleService (1 commit)
Étape 3 : Extraire CryptoAlgoBootstrap depuis index.ts (1 commit)
Étape 4 : NE PAS toucher à l'eval loop (décision documentée)
```

---

## R5 — C10 : Finish post-entry-mid-logger (P1)

### Contexte précis

- `post-entry-mid-logger.ts` : `schedulePostEntryMidLog` (ligne 48) crée 3 timers (+1s/+5s/+30s) via `setTimeout`. Les timers sont stockés dans `activeTimers: Map<TimerHandle, clearTimeout>` (module-global, ligne 32).
- `clearPostEntryMidTimers()` (ligne 37) clear tous les timers — utilisé dans `index.ts:554` (shutdown).
- `onSample` callback (ligne 70) n'est JAMAIS branché dans `index.ts`. Le call à `schedulePostEntryMidLog` (ligne 460) ne passe pas `onSample` → les samples sont loggés mais jamais persistés.
- **Pas de cancellation par position** : si une position est fermée avant +30s, les timers s'exécutent sur une position inexistante. `priceFeed.getOutcomePrices(conditionId)` retourne des prix mais le sample n'est pas associé à une position fermée — c'est juste un log, pas un crash, mais c'est du bruit.
- Aucune entité `PostEntryMidSample` n'existe dans `entities/index.ts` ou `data-source.ts`.

### Stratégie de mitigation : Entité + migration + cancellation par position

1. **Créer l'entité `PostEntryMidSample`** dans `core/entities/PostEntryMidSample.ts` :
   ```typescript
   @Entity('post_entry_mid_sample')
   export class PostEntryMidSample {
     @PrimaryGeneratedColumn() id!: number;
     @Column({ type: 'text' }) conditionId!: string;
     @Column({ type: 'text' }) outcome!: string;
     @Column({ type: 'integer', nullable: true }) positionId!: number | null;
     @Column({ type: 'bigint' }) filledAtMs!: number;
     @Column({ type: 'integer' }) offsetMs!: number;
     @Column({ type: 'real', nullable: true }) upMid!: number | null;
     @Column({ type: 'real', nullable: true }) downMid!: number | null;
     @Column({ type: 'bigint' }) sampledAtMs!: number;
     @CreateDateColumn() createdAt!: Date;
   }
   ```
   + migration `CreatePostEntryMidSamples1700000000095.ts`.
   + enregistrer dans `entities/index.ts` et `data-source.ts:entities[]`.

2. **Brancher `onSample`** dans `index.ts:460` :
   ```typescript
   schedulePostEntryMidLog({
     conditionId: payload.conditionId,
     outcome: payload.outcome,
     positionId: payload.positionId,
     filledAtMs: payload.filledAtMs,
     priceFeed,
     onSample: async (sample) => {
       await ds.getRepository(PostEntryMidSample).save({
         conditionId: payload.conditionId,
         outcome: payload.outcome,
         positionId: payload.positionId ?? null,
         filledAtMs: payload.filledAtMs ?? Date.now(),
         offsetMs: sample.offsetMs,
         upMid: sample.upMid,
         downMid: sample.downMid,
         sampledAtMs: sample.sampledAtMs,
       });
     },
   });
   ```

3. **Cancellation par position** : modifier `schedulePostEntryMidLog` pour retourner un handle avec une méthode `cancel()` :
   ```typescript
   export interface PostEntryMidHandle {
     timers: TimerHandle[];
     cancel: () => void;
   }
   ```
   Maintenir un `Map<number /* positionId */, PostEntryMidHandle>` dans `post-entry-mid-logger.ts`. Quand une position est fermée, appeler `cancelPostEntryMidTimersForPosition(positionId)`.
   **Le hook de fermeture** : dans le worker, `close-bid.ts` ou le processeur de close signale la fermeture. Ajouter un appel inter-package via Redis pub/sub `ALGO_POSITION_CLOSED_CHANNEL` que `index.ts` écoute et appelle `cancelPostEntryMidTimersForPosition`.

### Garde-fous concrets

1. **Timer leak detection** : test qui crée N positions, ferme toutes avant +1s, et vérifie que `activeTimers.size === 0` après cancellation.
2. **Shutdown test** : vérifier que `clearPostEntryMidTimers()` clear tous les timers même si `onSample` est en cours d'exécution async (le save DB peut échouer au shutdown — catch et log).
3. **Guard NaN** : `priceFeed.getOutcomePrices` peut retourner null si le marché est résolu. Vérifier que `upMid`/`downMid` sont nullable dans l'entité (déjà fait ci-dessus).
4. **Migration test** : la migration 0095 doit être testée sur une DB de test avant prod.
5. **Rétention** : ajouter un janitor de cleanup des samples > 14 jours (comme `shadowSampleRetentionDays` existe pour les shadow fills).

### Plan de rollback

- **Rollback immédiat** : ne pas brancher `onSample` (revert 1 commit). Les timers tournent mais ne persistent rien — comportement actuel, pas de regression.
- **Rollback DB** : migration 0095 `down()` drop la table. Pas d'impact sur le runtime.

### Séquencement

```
Étape 1 : Créer entité + migration 0095 (1 commit, test migration)
Étape 2 : Modifier schedulePostEntryMidLog pour retourner handle + Map par positionId (1 commit)
Étape 3 : Brancher onSample dans index.ts (1 commit)
Étape 4 : Ajouter cancellation hook via Redis pub/sub (1 commit, inter-package)
Étape 5 : Ajouter janitor de rétention (1 commit)
```

---

## R6 — C8 : Abstract crypto-algo ↔ weather-algo (P2)

### Contexte précis

- `crypto-algo/strategy/strategy-runner.ts` (951 lignes, class `StrategyRunner`) ↔ `weather-algo/strategy/strategy-runner.ts` (class `WeatherStrategyRunner`, ~529+ lignes).
- Divergences : crypto a WS price feed, Gamma cache, re-entry Redis, SL quota. Weather a forecast cache, pas de WS, pas de Gamma, polling-only.
- ~30 imports spécifiques chaque (crypto: `fetchGammaMarket`, `resolveCryptoAlgoReentryParams`, `CryptoAlgoPriceFeed` ; weather: `discoverWeatherMarkets`, `parseWeatherQuestion`, `WeatherForecastService`).
- **Coupling risk** : une base `AlgoStrategyRunner` dans `core/` partagerait le cycle d'éval. Mais un bug dans la base casserait crypto ET weather simultanément.

### Stratégie de mitigation : NE PAS abstraire — documenter et converger par copie consciente

**Principe** : le coupling est plus dangereux que la duplication. Crypto et weather ont des cycles de vie, des signaux, des données d'entrée fondamentalement différents. L'abstraction prématurée est un anti-pattern ici.

1. **Décision recommandée** : NE PAS extraire `AlgoStrategyRunner` dans `core/`. Garder les deux runners indépendants.

2. **À la place** : créer `docs/code/09-algo-shared-patterns.md` qui documente :
   - Le pattern commun (poll loop, config-driven tunables, runtime status publisher, janitor cycle).
   - Les divergences (WS vs polling, Gamma vs forecast, re-entry Redis vs in-memory).
   - Toute correction appliquée à un runner DOIT être évaluée pour l'autre (convention de commit `[mirror: weather-algo/strategy-runner]`).

3. **Si duplication insupportable** : extraire uniquement les utilitaires purs partagés (pas la logique d'éval) :
   - `safeInterval` est déjà dans `core/` (partagé).
   - Extraire `RuntimeStatusPublisher` base class dans `core/algo/` si les deux publishers ont le même shape. Vérifier `CryptoAlgoRuntimeStatusPublisher` vs `WeatherAlgoRuntimeStatusPublisher`.

### Garde-fous concrets

1. **Règle de review** : toute PR qui modifie `crypto-algo/strategy-runner.ts` DOIT mentionner si le même fix s'applique à weather. Le reviewer vérifie.
2. **Test d'indépendance** : s'assurer qu'aucun test ne dépend des deux runners simultanément (pas de shared fixture).
3. **Convention de commit** : `[crypto-only]` ou `[weather-only]` ou `[both]` dans le message.

### Plan de rollback

N/A — pas de refactor. Si extraction d'utilitaires purs : `git revert`.

### Séquencement

```
Étape 1 : Documenter le pattern partagé dans docs/code/09-algo-shared-patterns.md
Étape 2 : Évaluer RuntimeStatusPublisher pour extraction (si bénéfice réel)
Étape 3 : NE PAS extraire AlgoStrategyRunner (décision figée)
```

---

## R7 — Process discipline (plan manuel) (P3)

### Contexte

Le plan §0 exige une mise à jour manuelle à chaque étape. 5 phases, 30+ sous-étapes. Risque de désynchronisation.

### Stratégie de mitigation : Automatisation légère

1. **Script `tools/plan-progress.ts`** qui parse le plan markdown, compte les `[x]` vs `[ ]`, et génère un rapport de progression. À lancer en pre-commit si le plan est modifié.
2. **Pre-commit hook** : si `docs/plans/2026-08-06_PLAN-*.md` est modifié, vérifier que le "Statut global" en haut est cohérent (date mise à jour, phase marquée).
3. **Découper le plan en sous-fichiers** par phase si il devient trop long :
   - `docs/plans/2026-08-06_PHASE-2-audit-doc.md`
   - `docs/plans/2026-08-06_PHASE-3-refactor.md`
   - `docs/plans/2026-08-06_PHASE-4-bugs-fantomes.md`
   Le plan principal garde le statut global + liens.

### Garde-fous

- Reviewer le plan à chaque fin de session de travail (pas après chaque étape — trop fréquent).
- Timestamp automatique via git (le commit date sert de preuve).

### Rollback

N/A.

---

## R8 — C5 : Centralize Polymarket (P2)

### Contexte précis

- `circuit-breaker.ts`, `rate-limited-fetch.ts`, `token-bucket.ts` existent en 3 copies (core, worker, copy-trading).
- `api-client.ts` est différent (core=minimal, worker/copy-trading=riche) — ne PAS centraliser.
- Imports `sleep` diffèrent : `../helpers.js` (worker) vs `@polywatch/core` (copy-trading).

### Stratégie de mitigation : Move + re-export shim

1. **Centraliser dans `core/polymarket/`** : les 3 fichiers identiques. `core/polymarket/circuit-breaker.ts` devient la source.
2. **Re-export shim** dans `worker/polymarket/circuit-breaker.ts` et `copy-trading/polymarket/circuit-breaker.ts` :
   ```typescript
   export * from '@polywatch/core/polymarket/circuit-breaker';
   ```
   Permet aux imports existants de continuer à fonctionner sans tout changer d'un coup.
3. **Unifier `sleep`** : déplacer `sleep` dans `core/lib/sleep.ts` et l'importer depuis `@polywatch/core` partout.
4. **NE PAS toucher `api-client.ts`** — laissé spécifique par package.

### Garde-fous

1. **Build par package** : après chaque re-export, `npm run build -w @polywatch/worker` doit passer.
2. **Test** : `worker/polymarket/circuit-breaker.test.ts` si existe — le faire pointer sur le re-export.
3. **Diff** : avant de centraliser, vérifier que les 3 copies sont vraiment identiques avec `diff` ou `tools/diff-polymarket-utils.ts`.

### Rollback

`git revert` — les copies locales sont restaurées.

### Séquencement

```
Étape 1 : Vérifier identité des 3 copies (diff)
Étape 2 : Centraliser circuit-breaker + re-export shim
Étape 3 : Centraliser rate-limited-fetch + re-export shim
Étape 4 : Centraliser token-bucket + re-export shim
Étape 5 : Unifier sleep
Étape 6 (optionnel) : Supprimer les shims et importer directement depuis core
```

---

## R9 — C12 : Update api.md (P1)

### Contexte

Routes backend manquantes dans `api.md` : `system-audit`, `weather-algo-executions`, `weather-algo-capital`, `config-per-kind`. `audit-api-alignement.md` est un snapshot figé daté 2026-07-06.

### Stratégie de mitigation

1. **Ajouter les routes manquantes** dans `docs/api.md` avec le même format que les routes existantes (méthode, path, params, réponse, exemple).
2. **Marquer `audit-api-alignement.md` comme snapshot figé** : ajouter en haut du fichier :
   > ⚠️ **Snapshot figé** — Ce document est un audit ponctuel daté du 2026-07-06. Ne pas mettre à jour. Pour l'état courant des routes, voir `docs/api.md`.
3. **Script `tools/check-api-doc-coverage.ts`** qui compare les routes définies dans `backend/src/routes/*.ts` avec celles documentées dans `api.md`. À lancer en CI. Alerte si une route n'est pas documentée.

### Garde-fous

- Le script de coverage CI empêche la désync future.

### Rollback

N/A (doc only).

---

## RT — Risque transversal : No test safety net (P0)

### Contexte

- Tests unitaires existants : `*.test.ts` colocated (policy.test.ts, sim-execution-tunables.test.ts, crypto-algo-tunables.test.ts, etc.).
- Tests e2e : `e2e/crypto-algo/` (vitest), `e2e/weather-algo/`, `e2e/` (Playwright).
- **Manque** : tests couvrant les arêtes de transition (config absente au boot, shutdown en cours d'éval, Redis down, WS reconnect).
- Les refactors C1, C4, C6, C8 touchent du code critique sans intégration couvrant sim AND real AND crypto AND weather simultanément.

### Stratégie de mitigation : Filet de tests ciblé avant refactor

**Principe** : ne pas viser 100% de coverage. Viser les arêtes spécifiques aux risques du plan.

1. **Tests d'arête à créer avant tout refactor** (priorité par risque) :

   | Test | Fichier cible | Arête couverte | Risque mitigé |
   |------|---------------|----------------|---------------|
   | `risk-config-divergence.test.ts` | `core/risk/` | Compose RiskConfig depuis 4 tables isolées — détecte divergence | C4 |
   | `snapshot-decision-collector-parity.test.ts` | `core/simulation/` + `core/real/` | Sim et real collectors retournent le même shape pour mêmes inputs | C1 |
   | `strategy-runner-boot-no-config.test.ts` | `crypto-algo/strategy/` | StrategyRunner avant applyRiskTunables → throw, pas fallback | C9 |
   | `crypto-algo-shutdown.test.ts` | `crypto-algo/` | SIGTERM pendant eval → tous timers cleared, DS destroyed | C6 |
   | `post-entry-mid-timer-cancellation.test.ts` | `crypto-algo/` | Position fermée avant +30s → timers annulés | C10 |
   | `sim-real-archive-parity.test.ts` | `core/services/` | Archive sim et real produisent le même shape pour mêmes positions | C1 |

2. **Barrière de test avant refactor** :
   - Avant de toucher C4 : lancer `npm run test -w @polywatch/core` — doit être vert.
   - Avant de toucher C6 : lancer `npm run test -w @polywatch/crypto-algo` + `npm run test:e2e:crypto` — doivent être verts.
   - Après chaque commit de refactor : relancer les tests du package touché.

3. **Tests e2e comme guardrail d'intégration** :
   - `test:e2e:crypto` couvre le cycle complet crypto-algo (sim mode).
   - `test:e2e:weather` couvre weather-algo.
   - Lancer `npm run test:e2e:crypto:sim-reset` après tout refactor qui touche `sim-reset-redis-hygiene.ts` ou les queues.

4. **Smoke test de boot** : créer `e2e/crypto-algo/crypto-algo.boot.test.ts` qui démarre crypto-algo en mode test, vérifie qu'il est healthy (heartbeat Redis set), puis shutdown propre. Ce test couvre C6 shutdown + C9 boot.

### Garde-fous

- **Règle** : aucun refactor C1/C4/C6/C8 ne commence avant que les tests d'arête correspondants existent ET sont verts.
- **CI** : ajouter `tools/check-api-doc-coverage.ts` + `tools/diff-sim-real-snapshot.ts` + `tools/plan-progress.ts` en CI non-bloquants d'abord, bloquants après stabilisation.

---

## Recommandations transversales

### 1. Stratégie de branching

```
main (stable)
 └─ audit/phase-2-doc (Phase 2 — audit doc, low-risk)
 └─ audit/phase-3-c4-riskconfig (C4 — chantier P0, branche dédiée)
 └─ audit/phase-3-c1-simreal (C1 — sim/real, branche dédiée)
 └─ audit/phase-3-c6-godobjects (C6 — god-objects, branche dédiée)
 └─ audit/phase-4-c10-postentry (C10 — post-entry, branche dédiée)
```

Chaque branche = 1 PR. Merge après review + tests verts. Pas de big-bang.

### 2. Approche incrémentale

- **Ne jamais merge plus d'un finding critique par PR** (C4, C1, C6 séparés).
- **Commits atomiques** : 1 extraction = 1 commit. Facilite `git bisect` en cas de regression.
- **Tags** : après chaque phase, tagger `audit-phase-2-complete`, etc. Permet de revenir à un état stable connu.

### 3. Feature flags de sécurité

| Flag | Default | Effet | Rollback |
|------|---------|-------|----------|
| `RISK_CONFIG_LEGACY_FACADE` | `1` | Garde `getConfig()` legacy | `=0` force getters isolés |
| `RISK_CONFIG_STRICT` | `0` | Guard divergence log-only | `=1` fail-closed |
| `DEPRECATED_FALLBACKS_ENABLED` | `1` | Garde fallbacks constants | `=0` remplace par throws |

### 4. Ordre d'exécution global recommandé

```
PHASE A — Préparation (1 semaine)
  1. Créer tests d'arête (C4 divergence, C1 parity, C9 boot, C6 shutdown, C10 timers)
  2. Installer guards (divergence RiskConfig, log.warn fallbacks)
  3. Cartographier consommateurs RiskConfig

PHASE B — Doc (2 semaines, en parallèle de A)
  4. Phase 2 audit doc (2.1-2.14) — pas de risque code
  5. C12 api.md + script coverage

PHASE C — Critique P0 (3 semaines)
  6. C4 RiskConfig purge (Strangler Fig, consommateur par consommateur)
  7. C1 sim/real shared extraction (fonctions pures + constantes)
  8. C9 purge fallbacks (après 1 semaine de logs propres)

PHASE D — Structurel (2 semaines)
  9. C6 god-objects (GammaCacheService, ReEntryThrottleService, CryptoAlgoBootstrap)
  10. C5 centralize Polymarket (move + re-export)

PHASE E — Feature (1 semaine)
  11. C10 post-entry-mid-logger (entité + migration + onSample + cancellation)

PHASE F — Décisions différées
  12. C8 : NE PAS abstraire (documenter seulement)
  13. C2/C3 : refactor quartet config + utilitaires (P2, après stabilisation)
  14. C11/C13/C14/C15/C16 : doc only
```

### 5. Règle d'or finale

> **Aucun refactor critique (C4, C1, C6, C10) ne commence avant que le test d'arête correspondant existe, soit vert, et couvre le cas de transition (config absente, boot, shutdown, position fermée).** Le test est le filet ; le refactor est le saut. On ne saute pas sans filet.

---

*Cette annexe est un document vivant. À mettre à jour à chaque étape du plan, comme l'exige §0 du plan d'audit parent.*