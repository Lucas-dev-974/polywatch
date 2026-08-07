# Plan d'audit — `@polywatch/crypto-algo`

**Date** : 2026-08-07  
**Périmètre** : `packages/crypto-algo` (≈ 2 800 LOC hors tests)  
**Auteur** : Analyse de code automatisée (revue statique + type-check + tests)  
**Statut** : ✅ **100% implémenté** (P0 + P1 + P2 + P3 appliqués le 2026-08-07/08). Vérifié : `tsc --noEmit` ✅ · `vitest run` ✅ 102/102 · lint ✅ 0 erreur. Reste : test runtime manuel C2.

---

## 0. Journal d'application

| Date | Action | Fichiers modifiés | Vérification |
|---|---|---|---|
| 2026-08-07 | **C1** — Retrait total interpolation SQL dans `monitor.ts` → requêtes paramétrées (`make_interval(hours => $1)`) | `packages/crypto-algo/src/scripts/monitor.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 77/77 · grep `INTERVAL '\$\{` → 0 |
| 2026-08-07 | **C2** — Fail-fast sur `SERVICE_TOKEN` manquant/par défaut en production (`NODE_ENV=production`) | `packages/crypto-algo/src/config.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 77/77 |
| 2026-08-07 | **C3** — Injection `clobApi` dans `AlgoEntryPipelineParams` + retrait constante top-level `CLOB_API` | `packages/crypto-algo/src/processors/algo-entry-pipeline.ts`, `packages/crypto-algo/src/index.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 77/77 · grep `CLOB_API` → 0 · grep `process.env.POLYMARKET_CLOB_API` → 1 (config.ts only) |
| 2026-08-08 | **S1** — Correction message log fail-open → fail-closed (curve filter insufficient history) | `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 77/77 · grep `fail-open` → 0 |
| 2026-08-08 | **S2** — Alerte opérateur (UI banner via `postBackendAlert`) + retry backoff exponentiel sur échec mirroring Redis re-entry | `packages/crypto-algo/src/strategy/strategy-runner.ts`, `packages/crypto-algo/src/index.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 77/77 |
| 2026-08-08 | **S3** — Sérialisation des `reload()` concurrents via chaîne de promesses dans `SelectionLoader` | `packages/crypto-algo/src/selection-loader.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 77/77 |
| 2026-08-08 | **S6** — Ajout `connect(): Promise<void>` à `IBookWsClient` (`@polywatch/core`) + retrait `as any` dans `price-feed.ts` | `packages/core/src/worker-shared/connection-manager-interface.ts`, `packages/crypto-algo/src/price-feed.ts`, `e2e/crypto-algo/helpers/connection-manager-mock.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 77/77 · grep `as any` dans price-feed → 0 |
| 2026-08-08 | **S4** — Guard `shuttingDown` pour empêcher la recréation du `priceTickCleanupTimer` pendant le shutdown | `packages/crypto-algo/src/index.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 102/102 |
| 2026-08-08 | **S5** — Injection du cache SL quota via champ `StrategyRunner.slQuotaCache` + propagation au pipeline (`slQuotaCache` param) | `packages/crypto-algo/src/strategy/strategy-runner.ts`, `packages/crypto-algo/src/processors/algo-entry-pipeline.ts`, `packages/crypto-algo/src/index.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 102/102 |
| 2026-08-08 | **F2** — `captureClose`/`captureOpen` cancellables au shutdown via flag `aborted` dans `MarketSurveillanceRecorder` | `packages/crypto-algo/src/market-surveillance-recorder.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 102/102 |
| 2026-08-08 | **F5** — Extraction des helpers purs de `monitor.ts` vers `monitor-helpers.ts` + 25 tests unitaires | `packages/crypto-algo/src/scripts/monitor-helpers.ts`, `packages/crypto-algo/src/scripts/monitor-helpers.test.ts`, `packages/crypto-algo/src/scripts/monitor.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 102/102 (25 nouveaux tests) |
| 2026-08-08 | **S2+** — Guard `this.stopping` dans `mirrorReEntryFillWithRetry` pour arrêter les retries au shutdown | `packages/crypto-algo/src/strategy/strategy-runner.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 102/102 |
| 2026-08-08 | **F1** — Métrique ratio entrées/découvertes : compteurs `entriesThisCycle`/`evaluatedThisCycle` publiés dans le runtime-status (`entriesLastCycle`/`evaluatedLastCycle`) | `packages/crypto-algo/src/strategy/strategy-runner.ts`, `packages/crypto-algo/src/runtime-status.ts`, `packages/core/src/services/crypto-algo-runtime-status.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 102/102 |
| 2026-08-08 | **F3** — Alerte opérateur (UI banner) si deviation WS/Gamma ≥ 0.15 via `setAlertSink` sur `NaiveMomentumStrategy` (throttle 5min/conditionId) | `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts`, `packages/crypto-algo/src/index.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 102/102 |
| 2026-08-08 | **F4** — Coalescence `PositionContextCache.refresh` : refresh différé avec `pendingConditionIds` si un refresh est en flight | `packages/crypto-algo/src/position-context-cache.ts` | `tsc --noEmit` ✅ · `vitest run` ✅ 102/102 |

---

## 1. Contexte de l'audit

Audit statique de la codebase du package crypto-algo : revue de tous les fichiers `src/`, exécution du type-check (`tsc --noEmit` ✅) et des tests (`vitest run` ✅ 77/77 pass), recherche de patterns sensibles (`as any`, `@ts-ignore`, TODO/FIXME, interpolation SQL, secrets hardcoded).

### Résultats globaux de santé

| Indicateur | Résultat |
|---|---|
| Type-check (`tsc --noEmit`) | ✅ Pass |
| Tests (`vitest run`) | ✅ 77/77 pass (8 fichiers) |
| TODO/FIXME/HACK dans code prod | ✅ Aucun |
| `as any` / `@ts-ignore` | ✅ 0 occurrence (S6 résolu le 2026-08-08) |
| `@deprecated` | 1 (`getTopOfBookForCondition`) |
| Documentation | ✅ `docs/crypto-algo.md` riche et à jour |

Le package est **mature et défensif**. Les points critiques identifiés sont des problèmes d'hygiène (sécurité ops, duplication, configuration), pas des bugs de logique de trading.

---

## 2. Points CRITIQUES (à traiter en priorité)

### 🔴 C1. Injection SQL dans `scripts/monitor.ts` — ✅ APPLIQUÉ (2026-08-07)

**Localisation** : `packages/crypto-algo/src/scripts/monitor.ts`  
**Lignes concernées** : 103, 154, 191 (et toute autre interpolation `${...}` dans une chaîne SQL)

```typescript
// Ligne 103 (SQL_POSITIONS_AGG)
AND cp.opened_at >= NOW() - INTERVAL '${hours} hours'

// Ligne 154 (SQL_POSITIONS_CLOSED)
AND cp.closed_at >= NOW() - INTERVAL '${hours} hours'

// Ligne 191 (SQL_MARKET_ACTIVITY)
WHERE recorded_at >= NOW() - INTERVAL '${hours} hours'
```

**Problème** : Les requêtes SQL sont construites par **interpolation de chaîne** avec la variable `hours`. Bien que `sanitizePositiveNumber` borne la valeur (1–48) et rejette `NaN`, le pattern d'interpolation SQL est **intrinsèquement dangereux** et ne doit exister nulle part dans la codebase.

**Décision** : **Retrait total et définitif de toute interpolation de variable dans les SQL**. Toutes les requêtes doivent utiliser les **requêtes paramétrées** de TypeORM (`ds.query(sql, [params])`).

**Note PostgreSQL** : `INTERVAL '$1 hours'` ne fonctionne pas avec des paramètres bindés (PostgreSQL ne supporte pas le paramètre à l'intérieur d'un littéral `INTERVAL '...'`). La forme paramétrable est :

```sql
-- Au lieu de :
AND cp.opened_at >= NOW() - INTERVAL '${hours} hours'
-- Utiliser :
AND cp.opened_at >= NOW() - make_interval(hours => $1)
```

Ou alternativement calculer le cutoff côté application (`new Date(Date.now() - hours * 3600_000)`) et passer la date en paramètre.

**Action de vérification** : après refactor, grepper tout le package `crypto-algo` (et idéalement le monorepo) pour `INTERVAL '${` et `${` dans des chaînes SQL, et confirmer qu'il n'en reste aucune.

**Réalisation (2026-08-07)** : Les 3 requêtes SQL ont été converties :
- `SQL_POSITIONS_AGG` : fonction `(hours) => ...` → constante avec `make_interval(hours => $1)`, appel via `ds.query(SQL_POSITIONS_AGG, [env.durationHours])`.
- `SQL_POSITIONS_CLOSED` : idem.
- `SQL_MARKET_ACTIVITY` : idem.
- Vérification grep : `INTERVAL '${` → 0 occurrence dans tout `packages/crypto-algo/src`. Les seules interpolations `${...}` restantes sont dans des `console.log`/`path.join` (affichage et chemins), pas dans des SQL.

**Effort** : 30 min.

---

### 🔴 C2. Token de service par défaut faible (`config.ts:15`) — ✅ APPLIQUÉ (2026-08-07)

**Localisation** : `packages/crypto-algo/src/config.ts`

```typescript
14:  serviceToken:
15:    process.env.SERVICE_TOKEN ?? 'dev-service-token-change-in-prod-32',
```

**Explication détaillée** :

Le `serviceToken` est utilisé pour **authentifier le crypto-algo auprès du backend** Polywatch sur tous les appels HTTP sortants. Concrètement, il est placé dans le header `X-Service-Token` de chaque requête vers le backend (voir `packages/core/src/worker-shared/backend-client.ts:75` et `:107`) :

```typescript
// packages/core/src/worker-shared/backend-client.ts
headers: {
  'Content-Type': 'application/json',
  'X-Service-Token': clientConfig.serviceToken,
},
```

**Usages effectifs du `serviceToken` dans crypto-algo** :

1. **`fetchAvailableRealCash`** (`real-cash.ts`) → appelle `GET /api/internal/balances?mode=real` sur le backend pour récupérer le solde on-chain réel. Utilisé pour le sizing en mode `real`.
2. **`createBackendClient` → postBackendJson** (`index.ts:268-271`) → appelle `POST /api/algo/markets/notify-changed` pour notifier le frontend des changements de marchés.
3. **`AlgoChartTickPublisher`** (`algo-chart-tick-publisher.ts`) → publie les ticks de prix vers le backend pour le chart frontend.
4. **`AlgoMarketPercentPublisher`** (`algo-percent-publisher.ts`) → publie les % live vers le backend.

**Le risque** :

Le token par défaut `'dev-service-token-change-in-prod-32'` est **hardcoded dans le code source**, donc **public** (visible dans le repo Git). Si l'opérateur oublie de définir `SERVICE_TOKEN` en production :

- Le crypto-algo s'authentifie auprès du backend avec un token **connu de quiconque a accès au code**.
- Un attaquant ayant accès au réseau backend (ou au `backendUrl`) peut **forger le même header** et appeler `POST /api/algo/markets/notify-changed`, `GET /api/internal/balances`, etc. avec ce token dev.
- Le nom du token (`change-in-prod`) est un **avertissement**, mais rien ne **force** ce changement — c'est une convention fragile.

**Impact réel** : dépend de la surface backend exposée. Le endpoint `/api/internal/balances` expose le solde réel on-chain ; `notify-changed` peut perturber le frontend. Ce n'est pas un risque d'exécution d'ordre (le worker a sa propre auth), mais c'est une **fuite d'info financière** et une **surface d'attaque**.

**Recommandation** :

En production (`NODE_ENV === 'production'`), **lever une erreur fatale** si `SERVICE_TOKEN` n'est pas défini ou vaut le token dev. Fail-fast au démarrage plutôt que dégradation silencieuse.

```typescript
// logique cible (à valider avant implémentation) :
const serviceToken = process.env.SERVICE_TOKEN;
if (!serviceToken && nodeEnv === 'production') {
  console.error('SERVICE_TOKEN is required in production');
  process.exit(1);
}
```

**Réalisation (2026-08-07)** : Un guard fail-fast a été ajouté dans `config.ts`. Le token dev est extrait dans une constante nommée `DEV_SERVICE_TOKEN`, et si `NODE_ENV === 'production'` && `SERVICE_TOKEN` est absent ou égal au token dev, le process exit(1) avec un message clair. Le fallback dev reste autorisé en `development`/`test` pour préserver l'ergonomie locale.

```typescript
const DEV_SERVICE_TOKEN = 'dev-service-token-change-in-prod-32';
const rawServiceToken = process.env.SERVICE_TOKEN ?? DEV_SERVICE_TOKEN;
if (nodeEnv === 'production' && rawServiceToken === DEV_SERVICE_TOKEN) {
  console.error('SERVICE_TOKEN must be set to a non-default value in production ...');
  process.exit(1);
}
```

**Effort estimé** : 15 min.

---

### 🔴 C3. `CLOB_API` dupliqué et non injecté dans le pipeline d'entrée — ✅ APPLIQUÉ (2026-08-07)

**Localisation** :
- Déclaration : `packages/crypto-algo/src/processors/algo-entry-pipeline.ts:45`
- Utilisations : `algo-entry-pipeline.ts` lignes 159, 344, 468
- Doublon : `packages/crypto-algo/src/config.ts:18` (`config.clobApi`)

```typescript
// algo-entry-pipeline.ts:45 — déclaration locale
const CLOB_API = process.env.POLYMARKET_CLOB_API ?? 'https://clob.polymarket.com';

// algo-entry-pipeline.ts:159, 344, 468 — utilisations
clobApi: CLOB_API,
```

**Explication détaillée** :

Le `CLOB_API` est l'URL de l'API Polymarket CLOB (Central Limit Order Book). Il est utilisé dans le pipeline d'entrée pour les **gates de liquidité** :

1. **`gateAlgoEntryAskLiquidity`** (`algo-entry-pipeline.ts:155-162`) → vérifie la profondeur du carnet d'ask côté amont (upstream liquidity gate) avant d'autoriser l'entrée.
2. **`resolveEntryMinOrderSharesDetailed`** (`algo-entry-pipeline.ts:340-346`) → résout la taille minimale d'ordre MOS (Minimum Order Size) côté marché.
3. **`applyEntryMosGate`** (`algo-entry-pipeline.ts:461-470`) → applique le gate MOS (bump de quantité pour respecter le minimum marché).

**Le problème** :

`config.ts` définit **déjà** `config.clobApi` (ligne 18) qui lit exactement la même variable d'env `POLYMARKET_CLOB_API` avec le même fallback. Mais le pipeline d'entrée **ne reçoit pas `config.clobApi` en paramètre** — il **relit `process.env.POLYMARKET_CLOB_API` directement** au niveau module (constante top-level `CLOB_API`).

Conséquences :

1. **Deux sources de vérité** : `config.clobApi` et `CLOB_API` lisent la même env var, donc aujourd'hui elles sont cohérentes. Mais c'est **fragile** — si un jour on introduit un override de config non-env (ex: BDD), les deux divergent.

2. **Incohérence possible en test** : si l'env `POLYMARKET_CLOB_API` change **entre l'init du module** (constante `CLOB_API` capturée au `import`) et l'appel du pipeline, le pipeline utilise l'ancienne valeur. `config.ts` relit aussi au `import`, donc même problème, mais au moins c'est centralisé.

3. **Non-testabilité** : le pipeline ne peut pas être testé avec un CLOB API mock **sans modifier `process.env.POLYMARKET_CLOB_API`** avant l'import du module. Les tests existants n'ont pas ce problème car ils ne mock pas le CLOB, mais c'est un frein pour de futurs tests d'intégration.

4. **Incohérence architecturale** : `backendUrl` et `serviceToken` **sont déjà passés en paramètre** du pipeline via `AlgoEntryPipelineParams` (lignes 66-68). `clobApi` est le seul config qui n'est pas injecté — c'est une incohérence.

**Recommandation** :

- Ajouter `clobApi: string` à `AlgoEntryPipelineParams`.
- Dans `index.ts`, passer `config.clobApi` au pipeline (comme déjà fait pour `backendUrl`/`serviceToken`).
- Retirer la constante top-level `CLOB_API` du pipeline.
- Utiliser `params.clobApi` partout dans le pipeline.

Cela aligne le pipeline sur le pattern déjà utilisé pour `backendUrl`/`serviceToken` et rend le pipeline **testable et cohérent**.

**Réalisation (2026-08-07)** :
- Champ `clobApi: string` ajouté à `AlgoEntryPipelineParams` et à la signature de `runMode`.
- Constante top-level `const CLOB_API = process.env.POLYMARKET_CLOB_API ?? ...` **supprimée** du pipeline.
- Les 3 usages `clobApi: CLOB_API` (dans `gateAlgoEntryAskLiquidity`, `resolveEntryMinOrderSharesDetailed`, `applyEntryMosGate`) remplacés par `clobApi` (paramètre injecté).
- `index.ts` passe désormais `clobApi: config.clobApi` à `runAlgoEntryPipeline`.
- Vérification grep : `CLOB_API` → 0 occurrence dans `packages/crypto-algo/src` ; `process.env.POLYMARKET_CLOB_API` → 1 seule occurrence (dans `config.ts`, source de vérité unique).

**Effort estimé** : 20 min (1 champ interface + 3 usages + 1 passage dans `index.ts`).

---

## 3. Points SENSIBLES (à traiter en court terme)

### 🟠 S1. Commentaire de log contradictoire (fail-open vs fail-closed)

**Localisation** : `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts:430`

```typescript
log.debug(
  { conditionId, candidate, points, lookbackMs: this.config.curveLookbackMs },
  'curve filter enabled but insufficient mid history — fail-open',
);
```

Le code **abstient** (retourne `curve_insufficient`) — c'est du **fail-closed**. Le test `abstains curve_insufficient when history too sparse (fail-closed)` confirme. Le message de log dit `fail-open` — **contradictoire et trompeur**.

**Action** : corriger le message de log pour `fail-closed` (ne change pas la logique, pure lisibilité).

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Message de log corrigé : `'curve filter enabled but insufficient mid history — fail-closed (abstaining)'`. Aucun test ne validait le texte exact du log ; les tests validant le comportement fail-closed passent toujours.

---

### 🟠 S2. Mirroring Redis du throttle re-entry en fire-and-forget

**Localisation** : `packages/crypto-algo/src/strategy/strategy-runner.ts:281-294`

```typescript
if (this.redis && positionId != null && positionId > 0) {
  void recordCryptoReentryFill(this.redis, { ... }).catch((err) => {
    log.warn({ ... }, 'failed to mirror re-entry fill into Redis');
  });
}
```

Le mirroring Redis est fire-and-forget. Si Redis est down transitoirement (mirroring échoue puis Redis revient), l'état Redis est **incomplet** et sera lu comme valide au prochain restart → ré-entrée autorisée à tort.

**Mitigation actuelle** : le load Redis échoué déclenche un fail-closed (`shouldFailClosedOnReentryRedisLoad`). Mais un Redis down **transitoire** (mirroring échoué puis Redis revient) laisse un état Redis incomplet lu comme valide.

**Action** : alerter (pas juste `log.warn`) sur l'échec de mirroring, ou retry avec backoff.

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Les deux mécanismes ont été implémentés :
- **Retry backoff exponentiel** : nouvelle méthode privée `mirrorReEntryFillWithRetry(input, attempt)` qui retry avec un délai `min(500 * 2^attempt, 8000ms)`. Le compteur `reEntryMirrorFailures` est remis à 0 en cas de succès (avec log de recovery).
- **Alerte UI** : après `RE_ENTRY_MIRROR_ALERT_THRESHOLD = 3` échecs consécutifs, le sink `reEntryAlertSink` (branché sur `postBackendAlert('/api/internal/alerts', { type: 'warning', message })` dans `index.ts`) envoie un banner opérateur. Le seuil évite le spam ; l'alerte ne se déclenche qu'une fois par palier de 3 échecs.
- Le sink est injecté via `strategyRunner.setReEntryAlertSink(...)` (pattern cohérent avec `setOnAbstain`).

---

### 🟠 S3. Handler `config-changed` non sérialisé

**Localisation** : `packages/crypto-algo/src/index.ts:536-593`

Le handler `config-changed` lance un IIFE async en `void` sans suivi. Plusieurs messages en rafale → plusieurs reloads qui se chevauchent sans garantie d'ordre.

**Action** : ajouter une chaîne de promesses (comme `evalChains` dans `StrategyRunner`) pour sérialiser les reloads.

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — La sérialisation a été placée **dans le `SelectionLoader`** (source unique de vérité pour le snapshot) plutôt que dans `index.ts` (qui n'est qu'un consommateur parmi d'autres). Implémentation :
- Nouveau champ privé `reloadChain: Promise<void>` (initialisé à `Promise.resolve()`).
- `reload()` enchaîne désormais sur `reloadChain.then(() => this.doReload())` et retourne la chaîne. Les erreurs sont avalées avec log (la chaîne ne casse jamais).
- `doReload()` contient l'ancienne logique de `reload()` (load DB + swap snapshot).
- Couvre tous les appels concurrents : `config-changed` (index.ts), `subscribeToConfigChanges` (SelectionLoader), et le timer périodique 60s.

---

### 🟠 S4. Race `priceTickCleanupTimer` vs shutdown

**Localisation** : `packages/crypto-algo/src/index.ts:571-588`

Le `priceTickCleanupTimer` est recréé à chaque `config-changed`. Si un `config-changed` arrive pendant le shutdown, fenêtre où le timer peut être recréé après le clear.

**Action** : guard avec un flag `shuttingDown` ou déplacer la recréation dans le `safeInterval`.

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Un flag `shuttingDown` (boolean) est setté à `true` au début de `clearProcessTimers` dans le shutdown handler. Le handler `config-changed` vérifie ce flag avant de recréer le `priceTickCleanupTimer` et skip la reconfiguration si le shutdown est en cours (avec log informatif).

---

### 🟠 S5. Cache SL quota global module-level

**Localisation** : `packages/crypto-algo/src/strategy/sl-quota.ts:50`

```typescript
const globalSlQuotaCache = new Map<string, SlQuotaState>();
```

Cache au niveau module → pollution entre tests, non-injectable proprement.

**Action** : injecter le cache via constructeur (`StrategyRunner` ou un objet `SlQuotaCache`).

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Le cache SL quota est désormais injectable via un champ `slQuotaCache` sur `StrategyRunner` (setter `setSlQuotaCache`, getter `getSlQuotaCache`). Les méthodes `invalidateSlQuotaCache` et `cleanupSlQuotaState` utilisent le cache injecté s'il existe, sinon retombent sur le global. Le cache est créé dans `index.ts` (`new Map<string, SlQuotaState>()`), partagé entre `onSignal` (passé au pipeline via `AlgoEntryPipelineParams.slQuotaCache`) et le `StrategyRunner` (via `setSlQuotaCache`). Le pipeline propage le cache à `resolveSlQuotaEntryBlock({ cache })`. Le global reste pour la rétrocompatibilité mais n'est plus la voie principale.

---

### 🟠 S6. `as any` sur `wsClient.connect`

**Localisation** : `packages/crypto-algo/src/price-feed.ts:139`

```typescript
await (this.wsClient as any).connect?.();
```

L'interface `IBookWsClient` ne déclare pas `connect()`. Le cast `as any` masque une interface incomplète.

**Action** : corriger `IBookWsClient` dans `@polywatch/core` pour exposer `connect()`, retirer le cast.

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — L'interface `IBookWsClient` dans `packages/core/src/worker-shared/connection-manager-interface.ts` déclare désormais `connect(): Promise<void>`. Le cast `as any` a été retiré de `price-feed.ts:139` (appel direct `await this.wsClient.connect()`). Le mock `e2e/crypto-algo/helpers/connection-manager-mock.ts` a été mis à jour (`connect: async () => {}`) pour satisfaire l'interface. La classe concrète `PolymarketBookWebSocket` (worker) implémente déjà `connect(): Promise<void>` — aucune modification nécessaire côté worker.

---

## 4. Points de FRAGILITÉ (à surveiller)

### 🟡 F1. Fenêtre d'entrée très courte sur marchés 5m (documenté)

Cache Gamma TTL 10s + `minTimeToClose` ≈ 150s → **fenêtre utile ~2min 20** sur un marché 5min. Documenté dans `docs/crypto-algo.md`. Si la découverte auto-track prend >30s, la fenêtre utile tombe à <2min.

**Action** : monitorer le ratio `entrées / marchés découverts` par intervalle, alerter si < seuil.

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Deux compteurs (`entriesThisCycle`, `evaluatedThisCycle`) ont été ajoutés au `StrategyRunner`. Ils sont reset au début de chaque `tick()`, incrémentés pendant l'évaluation, et publiés dans le runtime-status via deux nouveaux champs du `CryptoAlgoRuntimeStatusPayload` : `entriesLastCycle` et `evaluatedLastCycle`. Le ratio `entriesLastCycle / evaluatedLastCycle` est désormais visible dans le runtime-status Redis, permettant au backend/monitor de détecter une stratégie inactive (ratio = 0 sur plusieurs cycles).

---

### 🟡 F2. `MarketSurveillanceRecorder.captureClose` boucle bloquante non cancellable

**Localisation** : `packages/crypto-algo/src/market-surveillance-recorder.ts:277-305`

Boucle `while (Date.now() < deadline)` avec `sleep(3s)`, lancée en fire-and-forget. Non cancellable au shutdown.

**Action** : rendre la boucle cancellable via un token lié au shutdown (ou `Promise.race` contre un signal d'arrêt).

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Un flag `aborted: boolean` a été ajouté à `MarketSurveillanceRecorder`. `shutdown()` le setté à `true` avant de clearer les timers. `captureClose` vérifie le flag au début (early return), dans la condition de boucle (`while (Date.now() < deadline && !this.aborted)`), et après la boucle (log d'abort + return). `captureOpen` vérifie aussi le flag au début.

---

### 🟡 F3. Deviation WS/Gamma non bloquante

**Localisation** : `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts:450-458`

Une deviation WS/Gamma ≥ 5% est loggée mais non bloquante. La stratégie utilise le mid WS. Documenté et conscient (la bande de prix 0.55–0.80 protège contre les mid aberrants).

**Action** : alerter si deviation > seuil élevé (ex: 0.15), pas juste `log.warn`.

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Un seuil `alertPriceDeviation` (0.15 par défaut) a été ajouté à `NaiveMomentumConfig`. Quand la deviation WS/Gamma dépasse ce seuil, la stratégie appelle un sink d'alerte optionnel (`setAlertSink`), injecté depuis `index.ts` et branché sur `postBackendAlert('/api/internal/alerts', { type: 'warning', message })`. Le throttling (5 min par conditionId via `lastDeviationAlertByCondition`) évite le spam d'alertes UI. Le `log.warn` existant (seuil 0.05) est conservé.

---

### 🟡 F4. `PositionContextCache.refresh` coalescence imparfaite

**Localisation** : `packages/crypto-algo/src/position-context-cache.ts:36-39`

Un second refresh avec des `conditionIds` différents attend le premier mais ne déclenche pas un nouveau refresh avec les nouveaux IDs.

**Action** : faible priorité (refresh toutes les 5s en timer fixe).

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Un champ `pendingConditionIds` a été ajouté à `PositionContextCache`. Quand un refresh arrive pendant qu'un autre est en flight, les nouveaux conditionIds sont mémorisés dans `pendingConditionIds`. Après la fin du refresh en cours, si `pendingConditionIds` est non-null, un refresh différé est déclenché avec ces IDs. La coalescence est désormais correcte : les nouveaux conditionIds ne sont plus perdus.

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Un champ `pendingConditionIds: string[] | null` a été ajouté à `PositionContextCache`. Quand un `refresh` arrive pendant qu'un refresh est en flight, les nouveaux `conditionIds` sont mémorisés dans `pendingConditionIds`. Après la fin du refresh en flight, si `pendingConditionIds` est non-null, un refresh différé est déclenché avec ces IDs (récursion via `this.refresh(next)`). Les IDs les plus récents sont ainsi toujours rafraîchis, pas seulement les premiers.

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Un champ `pendingConditionIds: string[] | null` a été ajouté. Si un refresh arrive pendant qu'un autre est en flight, les nouveaux conditionIds sont mémorisés dans `pendingConditionIds`. Après la fin du refresh en flight, si `pendingConditionIds` est non-null, un second refresh est déclenché avec ces IDs (et `pendingConditionIds` est reset). La récursion est bornée (au maximum un refresh différé par cycle, car le second refresh reset `pendingConditionIds` à `null` avant de s'exécuter).

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Un champ `pendingConditionIds` a été ajouté à `PositionContextCache`. Si un `refresh` arrive pendant qu'un refresh est en flight, les nouveaux conditionIds sont mémorisés dans `pendingConditionIds`. Après la fin du refresh en flight, si `pendingConditionIds` est non-null, un second refresh est déclenché avec ces IDs (récursif, mais borné à 1 niveau car `pendingConditionIds` est reset avant l'appel récursif).

---

### 🟡 F5. `scripts/monitor.ts` non testé

≈ 640 LOC avec 6+ requêtes SQL brutes, aucun test. Régression SQL (colonne renommée) casserait silencieusement le monitoring.

**Action** : tests de smoke sur le parsing des rows au minimum.

**Réalisation (2026-08-08)** ✅ APPLIQUÉ — Les helpers purs (`sanitizePositiveNumber`, `toFixed`, `groupBy`, `avg`, `SignalRow`) ont été extraits de `monitor.ts` vers un nouveau module `monitor-helpers.ts` (le script CLI `monitor.ts` déclenche `main()` au module-load, impossible à importer directement dans un test). `monitor.ts` importe désormais ces helpers depuis le module. 25 tests unitaires couvrent les edge cases (null/undefined/NaN/Infinity/négatifs, grouping avec valeurs null→"unknown", precision de arrondi, etc.). Le script `monitor.ts` n'a pas besoin de DB/Redis pour tester les helpers.

---

## 5. Points FORTS (à conserver)

- ✅ **Fail-closed throttle re-entry** quand Redis down (`shouldFailClosedOnReentryRedisLoad`).
- ✅ **Époques de config** (`configEpoch`) → signaux en cours droppés si config change mid-flight.
- ✅ **Coalescing des évaluations** (`evalChains`) → pas de double-fire WS + polling.
- ✅ **Shutdown idempotent ordonné** avec isolation des erreurs par step.
- ✅ **Gate liquidité fail-closed** → pas d'entrée sans carnet cible frais et bilatéral.
- ✅ **Validation somme YES+NO ~1.0** sur chemin Gamma.
- ✅ **Quota SL strict** (bloque si position déjà ouverte sur le marché, cross-outcome).
- ✅ **Cache Gamma borné** (MAX_GAMMA_CACHE_SIZE=100) + cleanup + eviction.
- ✅ **Reconnexion WS** clear midHistory/topOfBook (gates courbe ne spannent pas une outage).
- ✅ **Observabilité** : abstentions structurées, runtimeStatus, post-entry-mid-logger, algo_price_ticks.
- ✅ **Tests de race config** (`strategy-runner-config-race.test.ts`).

---

## 6. Plan d'action priorisé

| Priorité | # | Action | Effort | Risque si non traité | Statut |
|---|---|---|---|---|---|
| **P0 — Immédiat** | C1 | Retrait total interpolation SQL dans `monitor.ts` → requêtes paramétrées (`make_interval(hours => $1)`) | 30 min | SQLi (exploit bloqué par sanitize mais pattern dangereux) | ✅ Fait (2026-08-07) |
| **P0 — Immédiat** | C2 | Fail-fast sur `SERVICE_TOKEN` manquant/par défaut en production | 15 min | Auth backend avec token public | ✅ Fait (2026-08-07) |
| **P0 — Immédiat** | C3 | Injecter `clobApi` dans `AlgoEntryPipelineParams`, retirer constante top-level `CLOB_API` | 20 min | Non-testabilité, incohérence, divergence future | ✅ Fait (2026-08-07) |
| **P1 — Court terme** | S1 | Corriger le message de log `fail-open` → `fail-closed` | 5 min | Confusion future | ✅ Fait (2026-08-08) |
| **P1 — Court terme** | S2 | Alerte (pas juste warn) sur échec mirroring Redis re-entry | 20 min | Ré-entrée autorisée à tort après Redis transitoire | ✅ Fait (2026-08-08) |
| **P1 — Court terme** | S3 | Sérialiser les reloads `config-changed` (chaîne de promesses) | 30 min | Flicker WS, subscriptions superflues | ✅ Fait (2026-08-08) |
| **P1 — Court terme** | S6 | Corriger `IBookWsClient.connect()`, retirer `as any` | 15 min | Typage incomplet | ✅ Fait (2026-08-08) |
| **P2 — Moyen terme** | S4 | Guard `priceTickCleanupTimer` contre race shutdown | 15 min | Timer zombie | ✅ Fait (2026-08-08) |
| **P2 — Moyen terme** | S5 | Injecter cache SL quota (non-global) | 45 min | Testabilité, pollution tests | ✅ Fait (2026-08-08) |
| **P2 — Moyen terme** | F2 | Rendre `captureClose` cancellable au shutdown | 30 min | Shutdown retardé | ✅ Fait (2026-08-08) |
| **P2 — Moyen terme** | F5 | Tests smoke sur `monitor.ts` | 1h | Régression SQL silencieuse | ✅ Fait (2026-08-08) |
| **P3 — Surveillance** | F1 | Métrique ratio entrées/découvertes par intervalle | 1h | Stratégie inactive sur 5m sans le savoir | ✅ Fait (2026-08-08) |
| **P3 — Surveillance** | F3 | Alerte si deviation WS/Gamma > 0.15 | 30 min | Entrée sur prix corrompu | ✅ Fait (2026-08-08) |
| **P3 — Surveillance** | F4 | Coalescence `PositionContextCache` (basse priorité) | 30 min | Metrics stale | ✅ Fait (2026-08-08) |

**Effort restant** : 0 — tous les points (P0, P1, P2, P3) sont appliqués. Reste uniquement le test runtime manuel C2.

**Vérifications post-P0 (2026-08-07)** :
- `npx tsc --noEmit -p packages/crypto-algo/tsconfig.json` → ✅ pass
- `npx vitest run` → ✅ 77/77 pass (8 fichiers)
- `rg "CLOB_API" packages/crypto-algo/src` → 0 occurrence
- `rg "process\.env\.POLYMARKET_CLOB_API" packages/crypto-algo/src` → 1 occurrence (`config.ts` only)
- `rg "INTERVAL '\$\{" packages/crypto-algo/src` → 0 occurrence
- Les seules interpolations `${...}` restantes dans `monitor.ts` sont dans des `console.log` / `path.join` (affichage et chemins), aucune dans des SQL.

**Vérifications post-P1 (2026-08-08)** :
- `npx tsc --noEmit -p packages/crypto-algo/tsconfig.json` → ✅ pass
- `npx vitest run` → ✅ 77/77 pass (8 fichiers, aucune régression)
- `rg "as any" packages/crypto-algo/src/price-feed.ts` → 0 occurrence (S6 résolu)
- `rg "fail-open" packages/crypto-algo/src` → 0 occurrence trompeuse (S1 résolu)
- Lint sur les 6 fichiers modifiés → 0 erreur

**Vérifications post-P2 (2026-08-08)** :
- `npx tsc --noEmit -p packages/crypto-algo/tsconfig.json` → ✅ pass
- `npx vitest run` → ✅ 102/102 pass (9 fichiers, 25 nouveaux tests pour les helpers monitor)
- Lint sur les 7 fichiers modifiés → 0 erreur

---

## 7. Vérifications post-implémentation

Après implémentation de chaque point, vérifier :

1. **C1** : `rg "INTERVAL '\$\{" packages/crypto-algo` → 0 résultat. ✅ Vérifié (2026-08-07).
2. **C2** : démarrer sans `SERVICE_TOKEN` et `NODE_ENV=production` → exit code 1 avec message clair. ⬜ À vérifier manuellement (test runtime).
3. **C3** : `rg "process\.env\.POLYMARKET_CLOB_API" packages/crypto-algo/src/processors` → 0 résultat (la seule référence reste dans `config.ts`). ✅ Vérifié (2026-08-07).
4. **Type-check** : `npx tsc --noEmit -p packages/crypto-algo/tsconfig.json` → pass. ✅ Vérifié (2026-08-07).
5. **Tests** : `npm test -w @polywatch/crypto-algo` → 77+ pass (pas de régression). ✅ Vérifié (2026-08-07, 77/77 pass).

---

## 8. Notes

- **P0 (C1, C2, C3) a été appliqué le 2026-08-07** : voir le journal d'application en section 0 et les blocs "Réalisation" sous chaque section C.
- **P1 (S1, S2, S3, S6) a été appliqué le 2026-08-08** : voir le journal d'application en section 0 et les blocs "Réalisation" sous chaque section S.
- **P2 (S4, S5, F2, F5) a été appliqué le 2026-08-08** : voir le journal d'application en section 0 et les blocs "Réalisation" sous chaque section. S5 a nécessité une décision de design (injection simple via champ StrategyRunner). F2 a nécessité une décision de mécanisme (token d'abort boolean). F5 a nécessité une décision de scope (extraction des helpers purs vers `monitor-helpers.ts` car `monitor.ts` déclenche `main()` au module-load).
- Les estimations d'effort supposent une connaissance du package et un environnement de dev fonctionnel.
- Les points P0 (C1, C2, C3) étaient indépendants et ont été traités dans une seule passe.
- Les points P1 (S1, S2, S3, S6) ont été traités dans une seule passe. S2 a nécessité une décision de design (mécanisme d'alerte : postBackendAlert + retry backoff). S3 a nécessité une décision de design (lieu de sérialisation : SelectionLoader plutôt que index.ts). S6 a nécessité une décision de scope (modification de l'interface partagée `IBookWsClient` dans `@polywatch/core`).
- Les points P2 (S4, S5, F2, F5) ont été traités dans une seule passe.
- Les points P3 (F1, F3, F4) ont été appliqués le 2026-08-08 dans une seule passe. F1 ajoute les métriques `entriesLastCycle`/`evaluatedLastCycle` au runtime-status. F3 ajoute une alerte UI (throttle 5min) sur deviation WS/Gamma ≥ 0.15. F4 corrige la coalescence du `PositionContextCache` via `pendingConditionIds`.
- **C2 nécessite un test runtime manuel** : démarrer le service avec `NODE_ENV=production` sans `SERVICE_TOKEN` (ou avec le token dev) et confirmer l'exit(1) avec le message d'erreur. Le type-check et les tests unitaires ne couvrent pas cette vérification car `config.ts` est importé au démarrage et le guard s'exécute au module-load.