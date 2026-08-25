# Plan — Weather algo : snapshot fail-open, TTL Redis, throttle per-strategy, shuttingDown

**Date** : 2026-08-25
**Auteur** : Assistant IA
**Statut** : 🟡 **En attente d'implémentation** — vague **A** du [plan maître](./2026-08-25_PLAN-weather-algo-implementation-master.md)
**Référence audit** : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md)
**Constats couverts** : #9 (snapshot fail-open), #10 (compteur Redis sans TTL), #11 (pas de shuttingDown), #14 (throttle re-entry transversal)

---

## 📋 Contexte

Quatre constats de robustesse / hygiène du moteur live :

- **#9** : si `persistEntryForecastSnapshot` échoue, l'ordre part quand même (fail-open) mais l'exit evaluator ne peut pas évaluer drift/bucket (position tenue jusqu'à résolution / SL).
- **#10** : `incrementWeatherReentryCount` fait `INCR` sans `EXPIRE` — les clés s'accumulent.
- **#11** : pas de flag `shuttingDown` (contrairement à crypto-algo) — entrée possible entre SIGTERM et `process.exit`.
- **#14** : la clé de throttle re-entry ne contient pas `strategyId` — un close forecast bloque aussi highest-yes.

**Décisions produit** :
- #9 : garder fail-open + ajouter une alerte / métrique (entry sans snapshot).
- #14 : rendre le throttle per-strategy.

> **Correction revue 2026-08-25** :
> - TTL compteur : **pas** un plat 7 j (`lookAheadDays` jusqu'à 30). Expirer depuis `dateIso` + buffer ; `EXPIRE` aussi si TTL actuel = `-1` (clés déjà incrémentées).
> - Shutdown : `stop()` pose déjà `stopped` (empêche le **prochain** cycle). Le trou = cycle **en cours**. Un second flag `shuttingDown` diverge. Réutiliser `stopped` + checks **intra-cycle** (après exits, avant entries, avant chaque `onSignal`).
> - Snapshot : persist **après reserve, avant enqueue**. Fail-open laisse une réservation sans snapshot. Documenter ; l'alerte porte `copiedPositionId`. Canal : **clé Redis** `weather-algo:snapshot-missing:{copiedPositionId}` TTL 24 h **et** log pino error `alert: 'snapshot_missing'`.

---

## Phase 1 — Snapshot fail-open + alerte (constat #9)

### Problème

`persistEntryForecastSnapshot` (`weather-entry-pipeline.ts:510-580`) est wrappé dans un try/catch qui log une erreur mais laisse l'entry continuer. L'exit evaluator, sans snapshot, ne peut pas évaluer drift/bucket — la position reste ouverte jusqu'à résolution / SL/TP worker.

### Patch

1. **Garder le fail-open** (décision produit) — ne pas bloquer l'entry pour un souci d'audit.

2. **Alerte** : log pino **error** avec `alert: 'snapshot_missing'`, `copiedPositionId`, `conditionId`, `strategyId` **et** `SET` Redis `weather-algo:snapshot-missing:{copiedPositionId}` = `1`, TTL 24 h (lisible backend / UI). La réservation existe déjà : la position peut rester sans drift/bucket jusqu'à SL/résolution. `redisCmd` du pipeline doit exposer `set`.

3. **Ne pas** tenter un persist snapshot « best-effort plus tard » dans ce plan (course avec l'exit evaluator du cycle suivant). Si un retry async est ajouté plus tard, il doit être idempotent sur `copiedPositionId`.

4. **Documenter** dans `code/08-weather-algo.md` : fail-open = entry enqueue malgré snapshot KO ; pas de drift / bucket sur cette position.

### Fichiers touchés

- `packages/weather-algo/src/processors/weather-entry-pipeline.ts`
- Tests : `weather-entry-pipeline.test.ts` (cas snapshot fail → entry OK + alerte émise)

---

## Phase 2 — TTL sur le compteur Redis d'entrées (constat #10)

### Problème

`incrementWeatherReentryCount` (`weather-reentry-count.ts:27-36`) fait `INCR` sans `EXPIRE`. Les clés `weather-entry-count:{city}:{dateIso}:{strategyId}:{mode}` s'accumulent indéfiniment.

### Patch

1. **TTL dérivé de `targetDateIso`**, pas un plat 7 jours (`lookAheadDays` max **30** : un compteur posé J-20 mourrait avant la résolution et **ré-autoriserait** des re-entries).

```ts
function reentryCountTtlSeconds(targetDateIso: string, nowMs = Date.now()): number {
  const endMs = Date.parse(`${targetDateIso}T23:59:59Z`) + 2 * 24 * 3600 * 1000; // date + 2 j
  const ttl = Math.ceil((endMs - nowMs) / 1000);
  return Math.max(24 * 3600, Math.min(32 * 24 * 3600, ttl)); // [1 j, 32 j]
}

const count = await redis.incr(key);
const ttl = await redis.ttl(key); // -1 = existe sans expire (clés legacy)
if (count === 1 || ttl === -1) {
  await redis.expire(key, reentryCountTtlSeconds(targetDateIso));
}
```

`redisCmd` du pipeline doit exposer `ttl` / `expire` (aujourd'hui `Pick<Redis, 'exists' | 'get' | 'incr'>`).

2. Ne **pas** rappeler `EXPIRE` quand `ttl > 0` (évite de reset la fenêtre à chaque incr).

### Fichiers touchés

- `packages/core/src/redis/weather-reentry-count.ts`
- Tests : `weather-reentry-count.test.ts` (vérifier TTL posé au 1er incr, pas re-posé)

---

## Phase 3 — Throttle re-entry per-strategy (constat #14)

### Problème

`weatherReentryThrottleKey` (`weather-reentry-throttle.ts:6-10`) ne contient pas `strategyId`. Un close forecast pose un throttle qui bloque aussi `highest-yes` sur la même paire pendant `reentryThrottleMs`.

### Décision produit

Rendre le throttle per-strategy (ne pas pénaliser highest-yes après un close forecast).

### Patch

1. **Ajouter `strategyId` à la clé Redis** :

```ts
// weather-reentry-throttle.ts
export function weatherReentryThrottleKey(
  city: string,
  targetDateIso: string,
  mode: TradingMode,
  strategyId: string, // ← NOUVEAU
): string {
  return `weather-reentry:${normalizeWeatherCity(city)}:${targetDateIso}:${mode}:${strategyId}`;
}

export async function setWeatherReentryThrottle(
  redis: Pick<Redis, 'set'>,
  city: string,
  targetDateIso: string,
  mode: TradingMode,
  ttlMs: number,
  strategyId: string, // ← NOUVEAU
): Promise<void> {
  if (!city || !targetDateIso || ttlMs <= 0) return;
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  await redis.set(weatherReentryThrottleKey(city, targetDateIso, mode, strategyId), '1', 'EX', ttlSeconds);
}

export async function hasWeatherReentryThrottle(
  redis: Pick<Redis, 'exists'>,
  city: string,
  targetDateIso: string,
  mode: TradingMode,
  strategyId: string, // ← NOUVEAU
): Promise<boolean> {
  if (!city || !targetDateIso) return false;
  return (await redis.exists(weatherReentryThrottleKey(city, targetDateIso, mode, strategyId))) === 1;
}
```

2. **Mettre à jour les appelants** :
   - `weather-exit-evaluator.ts` (`setWeatherReentryThrottle` après bucket/drift close) : passer `strategyId` (résolu depuis le snapshot).
   - `weather-entry-pipeline.ts` (`hasWeatherReentryThrottle` dans `runMode`) : passer `signal.strategyId`.
   - `weather-reentry-after-sl.ts` (`setWeatherReentryThrottle` après SL close) : passer `strategyId`.

3. **Signature** : ajouter `strategyId` **en dernier** (pas au milieu) pour limiter les appels TS mal ordonnés. Tous les call-sites compilent : pipeline, exit evaluator, `weather-reentry-after-sl`, `weather-city-first.test.ts`.

   `weather-reentry-after-sl.ts` a déjà `strategyId` interne mais **ne le passe pas** à `setWeatherReentryThrottle` aujourd'hui — 5e arg TTL seulement. Ajouter le 6e.

4. **`sim-reset-redis-hygiene.ts`** : `weatherReentryThrottleKey` gagne un `strategyId` — la purge sim doit itérer `WEATHER_STRATEGY_IDS` (déjà importé pour les counts) pour les anciennes **et** nouvelles formes, ou SCAN `weather-reentry:{city}:{date}:{mode}*`. Documenter : clés legacy 4-segments expirent au TTL.

### Fichiers touchés

- `packages/core/src/redis/weather-reentry-throttle.ts`
- `packages/weather-algo/src/processors/weather-exit-evaluator.ts`
- `packages/weather-algo/src/processors/weather-entry-pipeline.ts`
- `packages/core/src/weather/weather-reentry-after-sl.ts`
- `packages/core/src/redis/sim-reset-redis-hygiene.ts` (clés throttle à 5 segments)
- Tests : `weather-reentry-throttle.test.ts`, `weather-city-first.test.ts`, `weather-exit-evaluator.test.ts`, `weather-entry-pipeline.test.ts`

---

## Phase 4 — Flag `shuttingDown` (constat #11)

### Problème

`stop()` pose `stopped = true` : les **prochains** ticks / `runEvaluationCycleGuarded` s'arrêtent. Un cycle **déjà dans** `runEvaluationCycle` (exits puis entries) n'est pas interrompu — c'est le vrai trou SIGTERM.

### Patch

**Ne pas** ajouter un second booléen `shuttingDown` qui peut diverger de `stopped`.

1. `shutdown` dans `index.ts` : appeler `strategyRunner.stop()` **en premier** (déjà le cas si on l'ordonne ainsi).
2. Dans `runEvaluationCycle` : après les exits, `if (this.stopped) return` (pas de nouvelles entries).
3. Avant chaque `onSignal` / enqueue : `if (this.stopped) return`.
4. Optionnel : `runWeatherEntryPipeline` refuse si un callback `isStopped` est passé — utile si l'enqueue est lent. Pas un deuxième flag process-global.

### Fichiers touchés

- `packages/weather-algo/src/index.ts` (`stop()` en premier au shutdown)
- `packages/weather-algo/src/strategy/strategy-runner.ts` (checks `this.stopped` intra-cycle)
- Tests : `strategy-runner.test.ts` (`stop()` au milieu → 0 enqueue)

---

## Checklist de validation

### Phase 1 (snapshot fail-open)
- [ ] Fail-open conservé (entry OK si snapshot fail)
- [ ] Clé Redis `weather-algo:snapshot-missing:{copiedPositionId}` TTL 24 h + log `alert: 'snapshot_missing'`
- [ ] Doc `code/08-weather-algo.md` : position sans snapshot = pas de drift/bucket
- [ ] Test : snapshot fail → entry OK + alerte

### Phase 2 (TTL compteur)
- [ ] TTL = `dateIso` + 2 j, clamp [1 j, 32 j] (pas 7 j plat)
- [ ] `EXPIRE` si `count === 1` **ou** `TTL === -1` (legacy)
- [ ] Pas de reset TTL si `ttl > 0`
- [ ] `redisCmd` étendu (`ttl` / `expire`)

### Phase 3 (throttle per-strategy)
- [ ] `strategyId` ajouté à la clé Redis
- [ ] Appelants mis à jour (exit evaluator, entry pipeline, reentry-after-sl)
- [ ] Migration douce (anciennes clés expirent naturellement)
- [ ] Tests : throttle forecast ne bloque pas highest-yes

### Phase 4 (arrêt propre)
- [ ] Un seul flag : `stopped` existant
- [ ] Check intra-cycle après exits + avant chaque entry
- [ ] Test : SIGTERM / `stop()` au milieu du cycle → 0 nouvel enqueue

---

## Références

- Audit : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md) §4 #9, #10, #11, #14
- Canvas : [`weather-algo-engine-audit.canvas.tsx`](../../C:/Users/lcsystem/.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-engine-audit.canvas.tsx)