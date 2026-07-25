# PATCH — Résilience des unhandled promise rejections & durcissement du reset simulation

**Date** : 2026-07-17
**Portée** : `worker`, `backend`, `frontend`, `crypto-algo`
**Motivation** : Le worker devenait HS (crash) lors d'un reset simulation, à cause d'unhandled promise rejections fatales sous Node.js 22.

## Contexte

Sous Node.js 22, une unhandled promise rejection termine le processus par défaut (`--unhandled-rejections=throw`). Le worker et le backend contenaient plusieurs appels async fire-and-forget (`void async()`, `.then()` sans `.catch()`, `setTimeout` avec async) qui, en cas d'erreur (Redis down, DB lente, WS coupé), produisaient une unhandled rejection → crash du worker. Le reset simulation aggravait le problème en émettant plusieurs pub/sub et purges Redis sans gestion d'erreur, et sans protection contre les resets concurrents.

## Changements

### Lot 1 — Worker (`packages/worker/src/index.ts`, `processors/strategy-processing.ts`)

1. **`strategy-processing.ts`** : `evaluateAll()` ne pouvait pas rejeter — ajout d'un bloc `catch` (log error) autour de `runEvaluateAll()`. Le `finally` reset `evaluating` et re-déclenche un rerun si demandé. Avant, une erreur DB/WS pendant l'évaluation → unhandled rejection → crash.

2. **`index.ts` — `marketResolvedDebounce`** : `processAll()` dans le `setTimeout` maintenant doté d'un `.catch()` (log warn).

3. **`index.ts` — Queue consumers** : Les 5 `startConsumer().catch()` (`moveQueueConsumer`, `orderQueueConsumer`, `algoOrderQueueConsumer`, `closeQueueConsumer`, `resultsQueueConsumer`) appellent désormais `process.exit(1)` après `log.fatal`. Sans cela, `log.fatal` ne fait que logger — le worker continuait en zombie avec une queue non consommée. Avec `process.exit(1)`, le superviseur (Docker/pm2) relance le worker.

4. **`index.ts` — Shutdown** : `clearTimeout` des 3 debounce timers (`algoSelectionsSyncTimer`, `backendReadyDebounceTimer`, `marketResolvedDebounce`) ajouté dans `shutdown()` pour éviter qu'un timer en vol ne tire après `ds.destroy()`.

5. **`index.ts` — Dispatcher Redis** : Refactor du `if/else if` chain sur `redisSub.on('message')` en un `Map<channel, handler>` (`messageHandlers`). Chaque handler encapsule sa propre gestion d'erreur. Canal inconnu → `log.warn`.

### Lot 2 — Backend (`packages/backend/src/index.ts`, `services/e2e-runner.service.ts`)

1. **`index.ts` — `shutdown()`** : `ds.destroy()` maintenant doté d'un `.catch()` (en plus du `.finally()` existant). Avant, un échec de destroy → unhandled rejection.

2. **`e2e-runner.service.ts`** : `cancelRun`/`finishRun` dans les handlers `setTimeout`, `child.on('close')`, `child.on('error')` maintenant dotés de `.catch()`. Ajout d'un logger pino dédié (`e2e-runner`).

### Lot 3 — Reset simulation (`packages/backend/src/routes/simulation.ts`)

1. **Lock Redis contre resets concurrents** : `SET sim:reset:lock 1 PX 10000 NX` au début du handler. Si le lock est déjà tenu → `409 reset_already_in_progress`. Si Redis est injoignable → `503 reset_lock_unavailable`. Le lock est relâché dans le `finally` (`DEL sim:reset:lock`).

2. **Side-effects post-commit isolés** : Chaque side-effect (purge Redis, WS emit, `publishSimulationReset`, `publishConfigChanged`) est enveloppé dans un `try/catch` dédié. Un échec ne bloque pas les autres side-effects ni la réponse HTTP. Les échecs sont accumulés dans `warnings[]` et retournés au client.

3. **Réponse enrichie** : La réponse inclut désormais `redisPurge` (compteurs ou `null` si purge échoué) et `warnings[]` (codes d'échecs partiels : `redis_purge_failed`, `ws_emit_failed`, `publish_reset_failed`, `publish_config_failed`).

### Lot 4 — Frontend (`packages/frontend/src/lib/simulation.ts`)

1. **Type `SimResetResult`** : Ajout des champs `redisPurge?: SimResetRedisPurgeResult | null` et `warnings?: string[]` pour refléter le contrat réel de l'API. Le frontend ne lit pas encore ces champs, mais le type est désormais aligné.

### Lot 5 — Crypto-algo (`packages/crypto-algo/src/`)

1. **`index.ts` — `runMarketJanitorTick()`** : `try/catch` global autour de tout le corps. Avant, seuls `onMarketResolved` était catché ; `runMarketJanitorCycle`, `syncSelectionsAfterMarketChange` et `publishAlgoSelectionsChanged` pouvaient throw → unhandled rejection → crash.

2. **`selection-loader.ts` — `reload()`** : Séparé de `load()` (boot, throw) en une méthode indépendante qui catche silencieusement les erreurs DB. Avant, `reload()` déléguait à `load()` qui rethrowait → `void this.reload()` dans le handler `config-changed` produisait une unhandled rejection.

3. **`price-feed.ts` — `subscribeToMarkets()`** : `try/catch` global. Avant, `ensureTradableMarket` (DB/Gamma) et `wsClient.reconcile` (WS) pouvaient throw → `void this.priceFeed.subscribeToMarkets(...)` dans `strategy-runner.ts` produisait une unhandled rejection.

4. **`market-surveillance-recorder.ts` — `captureOpen()`** : `try/catch` global. Avant, `recordOpenSnapshot` (écriture DB) pouvait throw → `void this.captureOpen(...)` produisait une unhandled rejection.

5. **`market-surveillance-recorder.ts` — `captureClose()`** : `getByConditionId` déplacé à l'intérieur du `try` (avant, s'exécutait avant le `try` → erreur DB = unhandled rejection). Ajout d'un `catch` (avant, `try` n'avait qu'un `finally` → erreur non attrapée par le `try` interne propageait).

6. **`index.ts` — Shutdown** : Flag `shuttingDown` anti re-entrance (double SIGTERM ignoré). `safeQuit` helper pour les 3 connexions Redis (`.catch(() => {})`). `ds.destroy().catch(() => {})`. Avant, un double signal ou une connexion déjà fermée produisait une unhandled rejection.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/worker/src/index.ts` | Dispatcher Redis Map, `.catch()` sur debounce, `process.exit(1)` sur crash consumer, `clearTimeout` au shutdown |
| `packages/worker/src/processors/strategy-processing.ts` | `catch` dans `evaluateAll()`, logger pino |
| `packages/backend/src/index.ts` | `.catch()` sur `ds.destroy()` au shutdown |
| `packages/backend/src/services/e2e-runner.service.ts` | `.catch()` sur `cancelRun`/`finishRun`, logger pino |
| `packages/backend/src/routes/simulation.ts` | Lock Redis, side-effects isolés, `warnings[]`, `try/catch` sur acquisition lock |
| `packages/frontend/src/lib/simulation.ts` | Type `SimResetResult` enrichi (`redisPurge`, `warnings`) |
| `packages/crypto-algo/src/index.ts` | `try/catch` dans `runMarketJanitorTick`, durcissement shutdown (`shuttingDown`, `safeQuit`) |
| `packages/crypto-algo/src/selection-loader.ts` | `reload()` séparé de `load()` (silent sur erreur) |
| `packages/crypto-algo/src/price-feed.ts` | `try/catch` global dans `subscribeToMarkets` |
| `packages/crypto-algo/src/market-surveillance-recorder.ts` | `try/catch` dans `captureOpen` + refactor `captureClose` (getByConditionId dans try, catch ajouté) |

## Documentation mise à jour

- `docs/code/04-worker.md` : section dispatcher Redis, resilience patterns, section shutdown
- `docs/code/05-backend.md` : description route reset (lock, warnings, 409/503)
- `docs/api.md` : description endpoint reset (lock, warnings, codes d'erreur)
- `docs/code/07-crypto-algo.md` : section resilience patterns, section shutdown durcie

## Audit post-implémentation

Un audit final a identifié les points suivants (non bloquants, hors scope de ce patch) :

- **Worker shutdown** : les watchdogs internes (`startEvaluation`, `startLoop`, etc.) ne sont pas stoppés avant `ds.destroy()` — les rejections sont absorbées par `safeInterval`/`try/catch` mais génèrent du logging bruyant. Un flag `shuttingDown` pour inhiber le `process.exit(1)` des consumers pendant le shutdown est prévu en durcissement futur.
- **Lock TTL reset** : 10 s peut être court si la transaction DB + purge Redis est lente. À surveiller.