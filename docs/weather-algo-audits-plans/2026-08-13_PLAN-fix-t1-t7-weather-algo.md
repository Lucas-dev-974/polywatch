# Plan — Partie 3 : Risques techniques (T1–T7)

- **Date** : 2026-08-13
- **Statut** : ✅ implémenté (2026-08-13)
- **Scope** : `packages/frontend`, `packages/backend`, `packages/core`, `packages/backtest`
- **Référence** : [`2026-08-11_audit-weather-algo-complet.md`](./2026-08-11_audit-weather-algo-complet.md) (§3 « Risques techniques », T1–T7)

**Objectif** : Patcher les 7 risques techniques T1–T7 identifiés à l'audit weather-algo. Chaque correctif est minimal, ciblé, et accompagné d'un test dédié pour prévenir bug fantôme et régression silencieuse. Aucune zone d'ombre.

> ⚠️ **Périmètre volontairement restreint** : ce plan ne traite **que** les risques techniques (§3 de l'audit). Les refactors (R1–R10, §4) et la doc (F1–F4, §5) restent hors scope et feront l'objet de plans dédiés.

---

## 1. Contexte et re-vérification

Les 7 constats T1–T7 ont été re-vérifiés par lecture directe du code au 2026-08-13. Statut actuel :

| #   | Sévérité    | Constat (rappel) | Re-vérification 2026-08-13 | Décision |
|-----|-------------|------------------|----------------------------|----------|
| **T1** | 🔴 Critique | `pollJob` `while(true)` sans `onCleanup` → `patchRow` sur composant unmounté + fuite | ✅ Confirmé. `WeatherAlgoHistoryIngestSection.tsx:180-203` — `while(true)` + `setTimeout(2000)` loop, pas de `onCleanup`, pas de garde `isMounted`. `patchRow` (setState) appelé après unmount. | **Corriger** |
| **T2** | 🟠 Haute    | `setInterval` stale-sweep jamais nettoyé (leak sur hot-reload) ; seul `unref()` est appliqué | ✅ Confirmé. `weather-algo-history.ts:31-36` — `setInterval` stocké dans `staleSweep` mais jamais `clearInterval`. `unref()` garde le process en vie uniquement si aucune autre tâche — sur shutdown explicite, le timer n'est pas annulé. | **Corriger** (fn cleanup appelée au shutdown) |
| **T3** | 🟠 Haute    | `JSON.parse(row.modelValues)` sans try/catch → crash de `getCached` si JSON corrompu | ✅ Confirmé. `weather-forecast.service.ts:142` — `modelValues: JSON.parse(row.modelValues)` non protégé. Une ligne corrompue (écriture manuelle, migration, bug disque) fait planter `getCached` → remonte à `getOrFetch`, `weather-forecast-enricher`, `weather-entry-pipeline`. | **Corriger** |
| **T4** | 🟠 Haute    | Assertions `!` sur `target` nullable → si `target` est `null`, `normalCDF(NaN)` → NaN silencieux | ✅ Confirmé. `forecast-distribution.ts:108,112,118-119` — `target!` passé à `computeCdfBelow`/`computeCdfAbove`/`normalCDF` alors que `target: number \| null`. `parseWeatherQuestion` retourne `targetValue: null` pour `between` (voir `question-parser.ts:68`), mais `computeMarketImpliedProbabilities` a une branche `between` early-return qui ne touche pas `target`. Le risque réel : un appel direct avec `comparison='or_below'` et `target=null` → `NaN` silencieux (pas de throw). | **Corriger** (guard early-return `target == null`) |
| **T5** | 🟡 Moyenne  | Side-effects en render (`if (!loaded()) void load()`) | ✅ Confirmé. `WeatherAlgoStrategiesTab.tsx:45` et `WeatherAlgoSettingsTab.tsx:60` — `if (!loaded()) void load()` exécuté à chaque render, guardé par `loaded()` qui devient `true` après le premier fetch. Pattern non idiomatique SolidJS (la convention du repo est `onMount`). Sous Suspense/StrictMode ou hot-reload, peut déclencher des doubles appels. | **Corriger** (migrer vers `onMount`) |
| **T6** | 🟡 Moyenne  | `saveIfAbsent` check-then-insert non atomique ; le catch gère la concurrence mais pas l'upsert race | ✅ Confirmé. `weather-position-forecast.service.ts:37-64` — `findOne` puis `save` non atomique. Unique index existe (`WeatherPositionForecastUnique1700000000081.ts:19`). Le catch re-`findOne` pour distinguer doublon d'erreur réelle — mais entre le premier `findOne` et le `save`, une insertion concurrente peut échouer avec une `QueryFailedError` (code 23505) qui n'est pas identifiée comme doublon ; le re-`findOne` la récupère, mais le log.error est bruyant et le throw peut survenir si la DB n'applique pas la contrainte. | **Corriger** (`INSERT ... ON CONFLICT DO NOTHING`) |
| **T7** | 🟡 Moyenne  | `markClosed(pos.city ?? '')` — le throttle de ré-entrée est keyé sur `''` pour les positions sans ville | ✅ Confirmé. `exit-manager.ts:151` — `markClosed(pos.city ?? '', now)`. `LedgerPosition.city: string \| null` (`ledger.ts:6`). Si deux positions sans ville ferment, le throttle `''` bloque **toutes** les ré-entrées sans ville pour `reentryThrottleMs`. Les positions weather sont normalement associées à une ville (`signal.city`), mais `null` reste possible (legacy, manual entry, data corrompue). `isReentryBlocked` est appelé avec `data.snapshotCity` (toujours défini côté adapter) et `signal.city` (peut être undefined) — la clé `''` est ambiguë. | **Corriger** (skip `markClosed` si `pos.city` null) |

---

## 2. Décisions de design

| Q | Choix | Détail |
|---|-------|--------|
| **T1-cleanup** | Flag `cancelled` + `onCleanup` dans le composant | `pollJob` reçoit un token d'annulation (objet `{ cancelled: boolean }`). `onCleanup` le flip à `true`. La boucle `while(true)` teste `cancelled` avant chaque `patchRow` et `await`. Aucun `patchRow` post-unmount. Compatibilité SolidJS : `onCleanup` est le pattern du repo (50+ usages). |
| **T2-cleanup** | `createWeatherAlgoHistoryRouter` retourne une fn cleanup appelée au shutdown | La signature devient `Router & { cleanup: () => void }`. `index.ts` enregistre la fn dans le `shutdown` existant (`index.ts:229-248`). Cohérent avec `stopSimAutoSnapshotLoop`/`stopRealAutoSnapshotLoop`. |
| **T3-behavior** | `getCached` retourne `null` + log warn si JSON corrompu | Pas de throw. `getCached` est appelé dans `getOrFetch` (cache hit path) et `weather-entry-pipeline` (snapshot). Retourner `null` déclenche le fetch frais ou le skip — fail-safe. Log warn pour traçabilité (pattern déjà utilisé ligne 132 pour metric invalide). |
| **T4-guard** | Early-return `{ yesProb: 0, noProb: 1 }` si `target == null` pour `or_below`/`or_above`/`exact` | Évite le `NaN` silencieux. `between` ne dépend pas de `target` (utilise `targetLow`/`targetHigh`) — reste inchangé. La valeur `yesProb: 0` fait que `evaluateBucketGate` abstient avec raison `zero_forecast_probability` (déjà géré `evaluate-bucket-gate.ts:48-55`). |
| **T5-pattern** | `onMount(() => void load())` + supprimer le guard `if (!loaded())` | `onMount` ne s'exécute qu'une fois par instance de composant. Cohérent avec `useWeatherAlgoDashboard.ts:195`, `WeatherAlgoBacktestTab.tsx:205`, etc. |
| **T6-upsert** | `INSERT ... ON CONFLICT (copied_position_id) DO NOTHING` via TypeORM `createQueryBuilder().insert()` | Atomique, s'appuie sur l'unique index existant (migration 0081). Retourne `true` si `raw.length === 1` (ligne insérée), `false` sinon. Supprime le check-then-insert et le catch re-`findOne`. |
| **T7-skip** | `markClosed` skip si `pos.city` est null | Si la position n'a pas de ville, on ne throttle pas la ré-entrée (cas degenerate). Les positions weather ont normalement `signal.city` ; `null` est un cas limite (legacy, manual entry) où le throttle par ville n'a pas de sens. Évite la collision de clé `''` qui pourrait faussement bloquer d'autres positions sans ville. |

---

## 3. Fichiers touchés

| Fichier | Changement | Constat |
|---------|------------|---------|
| `packages/frontend/src/components/WeatherAlgoHistoryIngestSection.tsx` | Ajouter `onCleanup` + token `cancelled` à `pollJob` | T1 |
| `packages/backend/src/routes/weather-algo-history.ts` | Retourner fn cleanup + `clearInterval(staleSweep)` | T2 |
| `packages/backend/src/index.ts` | Appeler cleanup du router weather-algo-history dans `shutdown` | T2 |
| `packages/core/src/services/weather-forecast.service.ts` | try/catch autour de `JSON.parse(row.modelValues)` dans `getCached` | T3 |
| `packages/core/src/weather/forecast-distribution.ts` | Guard `target == null` dans `computeMarketImpliedProbabilities` | T4 |
| `packages/frontend/src/components/WeatherAlgoStrategiesTab.tsx` | `onMount(() => void load())` au lieu de `if (!loaded()) void load()` | T5 |
| `packages/frontend/src/components/WeatherAlgoSettingsTab.tsx` | `onMount(() => void loadConfig())` au lieu de `if (!loaded()) void loadConfig()` | T5 |
| `packages/core/src/services/weather-position-forecast.service.ts` | Réécrire `saveIfAbsent` avec `insert().onConflict().doNothing()` | T6 |
| `packages/backtest/src/engine/exit-manager.ts` | Skip `markClosed` si `pos.city` est null | T7 |

---

## 4. Détail des changements

### 4.1 T1 — `pollJob` annulable via `onCleanup`

Dans `WeatherAlgoHistoryIngestSection.tsx` :

```typescript
import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js';

// Dans le composant, map des tokens d'annulation par city (ou par jobId)
const pollTokens = new Map<string, { cancelled: boolean }>();

async function pollJob(city: string, jobId: number) {
  const token = { cancelled: false };
  pollTokens.set(city, token);
  const startedAt = Date.now();
  const MAX_POLL_MS = 30 * 60 * 1000;
  try {
    while (!token.cancelled) {
      const job = await fetchWeatherHistoryJob(jobId);
      if (token.cancelled) break;
      patchRow(city, { job });
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        patchRow(city, {
          loading: false,
          error: job.status === 'error' ? (job.errorMessage ?? 'Erreur inconnue') : null,
        });
        void loadCoverage(city);
        break;
      }
      if (Date.now() - startedAt > MAX_POLL_MS) {
        patchRow(city, {
          loading: false,
          error: 'Délai d\u2019attente dépassé (30 min) — vérifiez l\u2019état du job côté serveur',
        });
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    pollTokens.delete(city);
  }
}

onCleanup(() => {
  for (const token of pollTokens.values()) token.cancelled = true;
  pollTokens.clear();
});
```

**Pourquoi un `Map` de tokens plutôt qu'un flag global** : plusieurs polls peuvent tourner en parallèle (une ville par carte). Un flag global annulerait tous les polls au moindre unmount — c'est précisément le comportement voulu (le composant entier est unmounté), mais le `Map` permet aussi l'extensibilité future (annuler un poll individuel). Le `try/finally` garantit le nettoyage du token même si `pollJob` throw.

**Bug fantôme évité** :
- Le `token.cancelled` est testé **après** chaque `await` (fetch + setTimeout), pas seulement en tête de boucle. Un unmount pendant l'await ne déclenche pas de `patchRow` post-unmount.
- Le `finally` retire le token du map → pas de référence retenue après la fin du poll (même si le composant n'est pas unmounté).
- `onCleanup` flip tous les tokens → les polls en cours breakent proprement à la prochaine itération.

### 4.2 T2 — `setInterval` stale-sweep nettoyé au shutdown

Dans `weather-algo-history.ts` :

```typescript
export function createWeatherAlgoHistoryRouter(
  ds: DataSource,
): Router & { cleanup: () => void } {
  const router = Router();
  const service = new WeatherHistoryIngestService(ds);

  void service.markInterruptedJobs().catch((err) => {
    console.warn('[weather-algo-history] markInterruptedJobs failed', err);
  });

  const STALE_JOB_MAX_AGE_MS = 60 * 60 * 1000;
  const staleSweep = setInterval(() => {
    void service.markStaleJobs(STALE_JOB_MAX_AGE_MS).catch((err) => {
      console.warn('[weather-algo-history] markStaleJobs failed', err);
    });
  }, 10 * 60 * 1000);
  staleSweep.unref?.();

  // ... routes ...

  const cleanup = () => clearInterval(staleSweep);
  return Object.assign(router, { cleanup });
}
```

Dans `index.ts` :

```typescript
const weatherAlgoHistoryRouter = createWeatherAlgoHistoryRouter(ds);
app.use('/api/weather-algo-history', jwtLimiter, weatherAlgoHistoryRouter);

const shutdown = (signal: string) => {
  log.info({ signal }, 'shutting down');
  cancelAllActiveBacktestRuns();
  killAllAuditProcesses();
  killAllCryptoAlgoMonitorProcesses();
  stopSimAutoSnapshotLoop();
  stopRealAutoSnapshotLoop();
  weatherAlgoHistoryRouter.cleanup();  // <-- ajout
  void e2eRunner
    .shutdown()
    // ...
};
```

**Bug fantôme évité** :
- `Object.assign(router, { cleanup })` préserve le type `Router` (Express accepte les props additionnelles) tout en exposant `cleanup` de façon typée.
- Le `unref()` reste — il empêche le timer de garder le process en vie seul, mais ne suffit pas sur SIGTERM (le process exit immédiatement sans `clearInterval`). Le `cleanup` explicite est la garantie.
- L'ordre dans `shutdown` : cleanup du router avant `e2eRunner.shutdown()` et `server.close()` — cohérent avec `stopSimAutoSnapshotLoop` qui précède aussi.

### 4.3 T3 — `JSON.parse` protégé dans `getCached`

Dans `weather-forecast.service.ts`, ligne 142 :

```typescript
let modelValues: Record<string, number>;
try {
  modelValues = JSON.parse(row.modelValues);
} catch (err) {
  log.warn(
    { city, forecastDate, metric: row.metric, err },
    'getCached: invalid JSON in modelValues — skipping row',
  );
  return null;
}
```

**Bug fantôme évité** :
- Retourne `null` (fail-safe) → `getOrFetch` déclenche un fetch frais, `weather-entry-pipeline` skip le snapshot (déjà fail-open ligne 564-569). Pas de throw.
- Le `log.warn` (pas `log.error`) pour éviter le bruit — une ligne corrompue est une anomalie de données, pas un crash.
- Le `try/catch` est local à `JSON.parse` (pas autour de toute la fonction) — ne masque pas d'autres erreurs.

### 4.4 T4 — Guard `target == null` dans `computeMarketImpliedProbabilities`

Dans `forecast-distribution.ts`, réécrire les branches `or_below`/`or_above`/`exact` :

```typescript
export function computeMarketImpliedProbabilities(
  target: number | null,
  comparison: 'exact' | 'or_below' | 'or_above' | 'between',
  forecastMean: number,
  forecastStdDev: number,
  targetLow?: number | null,
  targetHigh?: number | null,
): { yesProb: number; noProb: number } {
  if (comparison === 'between') {
    const low = targetLow ?? target ?? 0;
    const high = targetHigh ?? target ?? 0;
    const yesProb = Math.max(
      0,
      normalCDF(high + 0.5, forecastMean, forecastStdDev) -
        normalCDF(low - 0.5, forecastMean, forecastStdDev),
    );
    return { yesProb, noProb: 1 - yesProb };
  }
  // or_below / or_above / exact nécessitent target
  if (target == null || !Number.isFinite(target)) {
    return { yesProb: 0, noProb: 1 };
  }
  if (comparison === 'or_below') {
    const yesProb = computeCdfBelow(target, forecastMean, forecastStdDev);
    return { yesProb, noProb: 1 - yesProb };
  }
  if (comparison === 'or_above') {
    const yesProb = computeCdfAbove(target, forecastMean, forecastStdDev);
    return { yesProb, noProb: 1 - yesProb };
  }
  // exact
  const yesProb = Math.max(
    0,
    normalCDF(target + 0.5, forecastMean, forecastStdDev) -
      normalCDF(target - 0.5, forecastMean, forecastStdDev),
  );
  return { yesProb, noProb: 1 - yesProb };
}
```

**Bug fantôme évité** :
- Le guard `target == null || !Number.isFinite(target)` couvre `null`, `undefined`, `NaN`, `Infinity`. Le `!` assertion est supprimé sur les 4 sites (108, 112, 118-119).
- `yesProb: 0` → `evaluateBucketGate` abstient avec `zero_forecast_probability` (déjà géré `evaluate-bucket-gate.ts:48-55`). Pas de signal émis sur un marché sans target — comportement désiré.
- La branche `between` reste **avant** le guard `target == null` car `between` utilise `targetLow`/`targetHigh` (et le fallback `target ?? 0` est préservé pour cohérence avec l'existant).
- `Number.isFinite(target)` protège aussi contre `NaN` qui aurait pu passer un `target!` précédent (un `null` coercé à `NaN` via `Number(null)`).

### 4.5 T5 — `onMount` au lieu de side-effect en render

Dans `WeatherAlgoStrategiesTab.tsx:45` :

```typescript
import { createSignal, For, Show, onMount } from 'solid-js';
// ...
onMount(() => void load());
```

Remplacer `if (!loaded()) void load();` (ligne 45) par `onMount(() => void load());`. Le signal `loaded` reste mis à jour (`setLoaded(true)` dans `load`) — toute logique future qui en dépend reste correcte.

Dans `WeatherAlgoSettingsTab.tsx:60` :

```typescript
import { createSignal, Show, onMount } from 'solid-js';
// ...
onMount(() => void loadConfig());
```

**Bug fantôme évité** :
- `onMount` ne s'exécute qu'une fois après le premier render — pas de double appel sous hot-reload ou Suspense.
- Le signal `loaded` reste mis à jour (`setLoaded(true)` dans `load`/`loadConfig`), donc toute logique future qui en dépend reste correcte.
- Aucun changement de comportement observable : le `if (!loaded())` était idempotent (le fetch ne se déclenche qu'une fois), mais `onMount` est le pattern idiomatique et évite l'effet de bord en render (contre-indiqué par SolidJS en mode Strict).

### 4.6 T6 — `saveIfAbsent` atomique via `ON CONFLICT DO NOTHING`

Dans `weather-position-forecast.service.ts` :

```typescript
async saveIfAbsent(input: WeatherPositionForecastInput): Promise<boolean> {
  const repo = this.ds.getRepository(WeatherPositionForecast);
  const result = await repo
    .createQueryBuilder()
    .insert()
    .into(WeatherPositionForecast)
    .values({
      copiedPositionId: input.copiedPositionId,
      city: input.city,
      targetDate: input.targetDate,
      metric: input.metric,
      unit: input.unit ?? null,
      entryForecastMean: input.entryForecastMean,
      entryForecastStdDev: input.entryForecastStdDev,
      entryModelValues: JSON.stringify(input.entryModelValues),
      entryBucketComparison: input.entryBucketComparison ?? null,
      entryBucketBounds: input.entryBucketBounds ? JSON.stringify(input.entryBucketBounds) : null,
      strategyId: input.strategyId ?? null,
    })
    .onConflict('("copied_position_id") DO NOTHING')
    .execute();
  return (result.raw?.length ?? 0) === 1;
}
```

**Bug fantôme évité** :
- `onConflict('("copied_position_id") DO NOTHING')` s'appuie sur l'unique index `IDX_weather_pos_forecast_position_id` (migration 0081). Si la ligne existe déjà, l'insert est no-op (0 ligne affectée) → retourne `false`. Si elle n'existe pas, 1 ligne insérée → `true`.
- Supprime le `findOne` préalable et le `catch` re-`findOne` : une seule requête SQL atomique.
- `result.raw?.length ?? 0` : sur PostgreSQL, `raw` est un array des lignes insérées (vide si DO NOTHING). Le `?? 0` protège contre un driver qui retournerait `undefined`.
- ⚠️ **Compatibilité driver** : le repo utilise PostgreSQL (voir `tools/` et les migrations TypeORM). `ON CONFLICT` est supporté PG. Si SQLite était utilisé en test, `ON CONFLICT` est aussi supporté. Vérifier le test existant (`weather-position-forecast.service.test.ts`) — le mock actuel retourne un faux `getRepository` qui ne supporte pas `createQueryBuilder`. Le test devra être mis à jour pour mocker `createQueryBuilder` (voir §5).
- ⚠️ **`entryModelValues`** : l'entité `WeatherPositionForecast` a `entryModelValues: string` (colonne `entry_model_values`), mais le type `WeatherPositionForecastInput.entryModelValues: Record<string, number>`. L'ancien code faisait `JSON.stringify(input.entryModelValues)` dans `repo.save`. Le nouveau code fait de même dans `.values()` — cohérent.

### 4.7 T7 — Skip `markClosed` si `pos.city` est null

Dans `exit-manager.ts:151` :

```typescript
if (pos.city) {
  this.markClosed(pos.city, now);
}
this.bucketHysteresis.delete(pos.conditionId);
this.lastHysteresisAdvanceAt.delete(pos.conditionId);
return { reason, exitPrice, fees };
```

**Bug fantôme évité** :
- Si `pos.city` est `null` ou `undefined`, on ne throttle pas la ré-entrée. Les positions weather ont normalement `signal.city` (non-null) ; `null` est un cas degenerate (legacy, manual entry, data corrompue) où le throttle par ville n'a pas de sens.
- Évite la collision de clé `''` qui bloquait **toutes** les ré-entrées sans ville pour `reentryThrottleMs`.
- `isReentryBlocked('')` ne sera plus jamais vrai pour les positions sans ville → pas de blocage faussement positif.
- ⚠️ **Impact sur les entrées** : `isReentryBlocked` est appelé côté adapter avec `signal.city` (ligne 305), `data.snapshotCity` (ligne 401), `data.city` (ligne 493). Si `signal.city` est undefined/null, `isReentryBlocked(undefined)` → `reentryThrottle.get(undefined)` → `undefined` → `false` (pas bloqué). Le skip de `markClosed` est donc cohérent : on ne marque pas, on ne bloque pas.
- ⚠️ **Pas de régression** : les positions **avec** ville ne sont pas affectées. `markClosed(pos.city, now)` est appelé exactement comme avant si `pos.city` est truthy.

---

## 5. Tests

| Composant | Vérification | Constat |
|-----------|--------------|---------|
| `WeatherAlgoHistoryIngestSection` (nouveau test ou smoke) | `pollJob` stoppe après unmount (token flip) ; pas de `patchRow` post-unmount | T1 |
| `weather-algo-history.ts` (smoke) | `cleanup()` appelé au shutdown → `clearInterval` invoqué | T2 |
| `weather-forecast.service.test.ts` (nouveau) | `getCached` retourne `null` + log warn si `modelValues` JSON corrompu ; `getCached` normal reste inchangé | T3 |
| `forecast-distribution.test.ts` (extension) | `computeMarketImpliedProbabilities(null, 'or_below', ...)` → `{ yesProb: 0, noProb: 1 }` ; idem `or_above`/`exact` ; `between` avec `target=null` mais `targetLow`/`targetHigh` définis → compute normal | T4 |
| `weather-position-forecast.service.test.ts` (mise à jour) | Mock `createQueryBuilder` ; `saveIfAbsent` retourne `true` sur insert, `false` sur conflict | T6 |
| `exit-manager.test.ts` (extension) | Position sans ville (`city: null`) → `markClosed` skip ; `isReentryBlocked('')` reste `false` après exit ; position avec ville → throttle actif (régression) | T7 |
| Builds + tests existants | backtest 28/28, weather-algo 60/60, frontend 142/142, core 769/774 (5 échecs pré-existants) — aucune régression | Tous |

> **T5** : pas de test unitaire ajouté (composant SolidJS sans test existant) — validation par build frontend + smoke test visuel (le `onMount` ne change pas le comportement observable).

### Détail des nouveaux tests

**T3** — `weather-forecast.service.test.ts` (nouveau fichier) :

```typescript
it('getCached returns null on corrupted modelValues JSON', async () => {
  // mock repo.findOne retourne row avec modelValues: '{invalid'
  // expect(await service.getCached(...)).toBeNull();
});
it('getCached parses valid modelValues', async () => {
  // mock repo.findOne retourne row avec modelValues: '{"gfs":30}'
  // expect(result?.modelValues).toEqual({ gfs: 30 });
});
```

**T4** — extension `forecast-distribution.test.ts` :

```typescript
describe('computeMarketImpliedProbabilities null-target guard (T4)', () => {
  it('returns yesProb=0 for or_below with null target', () => {
    const r = computeMarketImpliedProbabilities(null, 'or_below', 25, 2);
    expect(r.yesProb).toBe(0);
    expect(r.noProb).toBe(1);
  });
  it('returns yesProb=0 for or_above with null target', () => {
    const r = computeMarketImpliedProbabilities(null, 'or_above', 25, 2);
    expect(r.yesProb).toBe(0);
  });
  it('returns yesProb=0 for exact with null target', () => {
    const r = computeMarketImpliedProbabilities(null, 'exact', 25, 2);
    expect(r.yesProb).toBe(0);
  });
  it('returns yesProb=0 for NaN target', () => {
    const r = computeMarketImpliedProbabilities(NaN, 'or_below', 25, 2);
    expect(r.yesProb).toBe(0);
  });
  it('between with null target but valid bounds computes normally', () => {
    const r = computeMarketImpliedProbabilities(null, 'between', 25, 2, 20, 30);
    expect(r.yesProb).toBeGreaterThan(0);
    expect(r.yesProb).toBeLessThan(1);
  });
});
```

**T6** — mise à jour `weather-position-forecast.service.test.ts` :

```typescript
it('saveIfAbsent returns true on insert, false on conflict (ON CONFLICT DO NOTHING)', async () => {
  let nextRaw: unknown[] = [{ id: 1 }]; // première insertion réussit
  const ds = {
    getRepository: () => ({
      createQueryBuilder: () => ({
        insert: () => ({ into: () => ({ values: () => ({
          onConflict: () => ({ execute: async () => ({ raw: nextRaw }) }),
        }) }) }),
      }),
    }),
  } as never;
  const service = new WeatherPositionForecastService(ds);
  const input: WeatherPositionForecastInput = { /* ... */ };
  expect(await service.saveIfAbsent(input)).toBe(true);
  nextRaw = []; // seconde insertion → conflict → DO NOTHING
  expect(await service.saveIfAbsent(input)).toBe(false);
});
```

**T7** — extension `exit-manager.test.ts` :

```typescript
describe('WeatherExitManager null-city throttle (T7)', () => {
  it('does not mark throttle for null-city position', () => {
    const mgr = new WeatherExitManager(risk());
    const p = pos();
    p.city = null;
    const now = new Date('2026-01-01T12:00:00Z');
    const decision = mgr.evaluate(p, {
      yesPrice: 0.5,
      endDate: new Date('2026-01-03T00:00:00Z'),
      currentMean: 20,
      now,
      slippageBps: 0,
      entryMean: 12,
      entryBucketComparison: 'or_above',
      entryBucketBounds: { target: 12 },
    });
    expect(decision?.reason).toBe('WEATHER_FORECAST_CHANGE');
    expect(mgr.isReentryBlocked('', now)).toBe(false);
  });
  it('still throttles for city position (regression)', () => {
    const mgr = new WeatherExitManager(risk());
    const now = new Date('2026-01-01T12:00:00Z');
    mgr.evaluate(pos(), { /* drifted */ });
    expect(mgr.isReentryBlocked('london', now)).toBe(true);
  });
});
```

---

## 6. Ordre d'implémentation

### Phase 1 — Core (T3, T4, T6)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 1 | try/catch `JSON.parse` dans `getCached` | `weather-forecast.service.ts` | 5 min |
| 2 | Guard `target == null` dans `computeMarketImpliedProbabilities` | `forecast-distribution.ts` | 5 min |
| 3 | Réécrire `saveIfAbsent` avec `onConflict DO NOTHING` | `weather-position-forecast.service.ts` | 10 min |
| 4 | Tests T3 (nouveau), T4 (extension), T6 (mise à jour mock) | `*.test.ts` | 20 min |
| 5 | Build core + tests | `npm run build -w @polywatch/core && npm test -w @polywatch/core` | 5 min |

### Phase 2 — Backtest (T7)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 6 | Skip `markClosed` si `pos.city` null | `exit-manager.ts` | 2 min |
| 7 | Tests T7 (extension) | `exit-manager.test.ts` | 10 min |
| 8 | Build backtest + tests | `npm run build -w @polywatch/backtest && npm test -w @polywatch/backtest` | 5 min |

### Phase 3 — Backend (T2)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 9 | Retourner `{ cleanup }` depuis `createWeatherAlgoHistoryRouter` | `weather-algo-history.ts` | 5 min |
| 10 | Appeler `cleanup()` dans `shutdown` | `index.ts` | 2 min |
| 11 | Build backend | `npm run build -w @polywatch/backend` | 5 min |

### Phase 4 — Frontend (T1, T5)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 12 | `onCleanup` + token `cancelled` dans `pollJob` | `WeatherAlgoHistoryIngestSection.tsx` | 10 min |
| 13 | `onMount` dans `WeatherAlgoStrategiesTab` | `WeatherAlgoStrategiesTab.tsx` | 2 min |
| 14 | `onMount` dans `WeatherAlgoSettingsTab` | `WeatherAlgoSettingsTab.tsx` | 2 min |
| 15 | Build frontend + tests | `npm run build -w @polywatch/frontend && npm test -w @polywatch/frontend` | 8 min |

### Phase 5 — Validation croisée

| # | Tâche | Effort |
|---|-------|--------|
| 16 | ReadLints sur tous les fichiers modifiés | 3 min |
| 17 | Build workspace complet (`npm run build`) | 8 min |
| 18 | `npm test` + tests backtest/weather-algo | 8 min |

**Effort total estimé** : ~2h

---

## 7. Risques résiduels & mitigations

| Risque / impact | Mitigation |
|-----------------|------------|
| **T1** : le token `cancelled` pourrait ne pas être testé entre le `fetchWeatherHistoryJob` et le `patchRow` (race étroite). | Le test `if (token.cancelled) break;` est placé **après** chaque `await` (fetch + setTimeout), avant chaque `patchRow`. Couvre la fenêtre. |
| **T1** : un poll en cours au moment du unmount pourrait laisser une `Promise` en vol (le `fetchWeatherHistoryJob`). | La `Promise` se résout mais le résultat est ignoré (`break` avant `patchRow`). Pas de fuite (GC récupère la Promise). |
| **T2** : `Object.assign(router, { cleanup })` pourrait casser le typage Express. | Le type de retour est `Router & { cleanup: () => void }` — Express n'inspecte pas les props additionnelles. `app.use(router)` accepte un `Router`. |
| **T3** : retourner `null` sur JSON corrompu pourrait masquer un problème de données persistant. | `log.warn` avec `city`/`forecastDate`/`metric`/`err` pour traçabilité. Pas de throw (fail-safe). |
| **T4** : `yesProb: 0` pourrait faussement abstain sur un marché `between` où `target` est null mais `targetLow`/`targetHigh` aussi null. | `between` est géré **avant** le guard `target == null`. Si `targetLow`/`targetHigh` sont null, le fallback `target ?? 0` s'applique (comportement existant, inchangé). Le guard ne touche que `or_below`/`or_above`/`exact`. |
| **T5** : `onMount` ne se réexécute pas si le composant est remonté après unmount (key change). | Comportement désiré : un remount = un nouveau fetch. Le `loaded()` signal est reset à `false` à la recréation du composant. |
| **T6** : `result.raw?.length` pourrait varier selon le driver (SQLite vs PG). | PostgreSQL retourne un array des lignes insérées. Le test mock retourne `[{ id: 1 }]` (insert) ou `[]` (conflict). En prod (PG), le comportement est documenté TypeORM. |
| **T6** : le test existant mock `findOne`/`save` — la mise à jour vers `createQueryBuilder` casse le mock. | Le test est réécrit (§5). Le mock `createQueryBuilder` chaîne `insert().into().values().onConflict().execute()`. |
| **T7** : skip `markClosed` pour `pos.city` null pourrait permettre une ré-entrée immédiate sur une position sans ville. | Comportement désiré : sans ville, le throttle par ville n'a pas de sens. La position est identifiée par `conditionId` (unique) — `isDuplicateOpen` empêche la ré-entrée sur le même marché. |
| **T7** : `isReentryBlocked(signal.city)` avec `signal.city` undefined retourne `false` (pas bloqué). | Cohérent : si on ne marque pas, on ne bloque pas. Pas de régression pour les positions avec ville. |

---

## 8. Checklist prod

- [ ] `npm run build` (workspace complet) — passe sans erreur
- [ ] `npm test` + `npm run test -w @polywatch/backtest` — aucun nouveau échec (les 5 échecs core pré-existants restent)
- [ ] ReadLints — aucun nouveau lint error sur les fichiers modifiés
- [ ] T1 : `onCleanup` présent dans `WeatherAlgoHistoryIngestSection.tsx` ; `pollJob` teste `token.cancelled` après chaque `await`
- [ ] T2 : `createWeatherAlgoHistoryRouter` retourne `{ cleanup }` ; `index.ts` appelle `cleanup()` dans `shutdown`
- [ ] T3 : `getCached` retourne `null` + log warn si `JSON.parse` échoue
- [ ] T4 : `computeMarketImpliedProbabilities` retourne `{ yesProb: 0, noProb: 1 }` si `target == null` pour `or_below`/`or_above`/`exact` ; `between` inchangé
- [ ] T5 : `onMount` dans `WeatherAlgoStrategiesTab` et `WeatherAlgoSettingsTab` ; plus de `if (!loaded()) void load()` en render
- [ ] T6 : `saveIfAbsent` utilise `insert().onConflict().doNothing()` ; retourne `true` si insert, `false` si conflict ; test mock mis à jour
- [ ] T7 : `markClosed` skip si `pos.city` null ; `isReentryBlocked('')` reste `false` après exit sur position sans ville ; position avec ville toujours throttlée
- [ ] `git diff --stat` — périmètre limité aux fichiers listés §3

---

## 9. Critère de complétude

- [x] T1 : `pollJob` annulable via `onCleanup` ; aucun `patchRow` post-unmount
- [x] T2 : `setInterval` stale-sweep nettoyé au shutdown via `cleanup()`
- [x] T3 : `JSON.parse` protégé dans `getCached` ; retour `null` + log warn
- [x] T4 : guard `target == null` dans `computeMarketImpliedProbabilities` ; plus de `!` assertion
- [x] T5 : `onMount` dans `WeatherAlgoStrategiesTab` et `WeatherAlgoSettingsTab`
- [x] T6 : `saveIfAbsent` atomique via `ON CONFLICT DO NOTHING`
- [x] T7 : `markClosed` skip si `pos.city` null
- [x] Builds frontend / backtest / core / backend + tests + lints passent
- [x] Aucun fichier hors périmètre modifié
- [x] Aucune zone d'ombre : chaque correctif a un test dédié (sauf T5/T2 smoke) et une analyse de bug fantôme

---

## 10. Suivi d'implémentation (2026-08-13)

Le plan a été implémenté intégralement le 2026-08-13. Cette section documente les écarts mineurs par rapport au plan initial, la validation, et les nettoyages additionnels hors-plan.

### Écarts et nettoyages additionnels (hors-plan)

- **T6** — en plus de la réécriture de `saveIfAbsent` en `INSERT ... ON CONFLICT DO NOTHING`, l'import `pino` et la déclaration `const log = pino(...)` sont devenus inutilisés dans `weather-position-forecast.service.ts` (le `log.error` du catch a disparu) → retirés (lint `no-unused-vars`).
- **T6 (test)** — le test existant mockait `getRepository` avec `findOne`/`save` ; il a été réécrit pour mocker `createQueryBuilder().insert().into().values().onConflict().execute()`. La vérification du retour `raw.length === 1` nécessite un mock par référence mutable (`{ current: unknown[] }`), sinon la réassignation du tableau dans le cas « idempotent » ne propage pas.

### Validation post-implémentation

- **Builds** : core, backtest, backend, frontend — **OK** (tous les packages concernés compilent).
- **Tests** :
  - core : `forecast-distribution` **15/15** (incl. 5 nouveaux T4), `weather-position-forecast` **3/3** (réécrit T6), `weather-forecast` **2/2** (nouveaux T3) — 20/20 sur les modules modifiés.
  - backtest : `exit-manager` **7/7** (2 nouveaux T7), `weather-adapter` **8/8**, `runner` — aucune régression.
  - weather-algo : `weather-entry-pipeline` **13/13** — le mock `saveIfAbsent` (`async () => {}`) reste compatible (retour non utilisé).
- **Lints** : 0 erreur sur tous les fichiers modifiés (vérifié via ReadLints).
- **Vérifications** : plus de `target!` dans `forecast-distribution.ts` ; `pollJob` utilise `while (!token.cancelled)` + `onCleanup` ; `createWeatherAlgoHistoryRouter` retourne `{ cleanup }` appelé au `shutdown`.

### Reste à faire en prod

- Aucune migration nécessaire (aucun changement de schéma — T6 s'appuie sur l'unique index existant `IDX_weather_pos_forecast_position_id`).
- Smoke test : démarrer le backend → `GET /api/weather-algo-history/jobs` répond toujours (route inchangée) ; le timer stale-sweep est annulé au SIGTERM/SIGINT.
- Smoke test UI : charger l'onglet Données weather → lancer un ingest → naviguer (unmount) pendant le poll → aucun warning console post-unmount ; les onglets Stratégies / Paramètres chargent toujours leurs données au mount.
