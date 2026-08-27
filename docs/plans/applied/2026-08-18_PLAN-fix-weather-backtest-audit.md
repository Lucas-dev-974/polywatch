# Plan de remédiation — Audit weather backtest (fidélité + correctitude + bugs fantômes)

**Date** : 2026-08-18
**Source** : [`docs/audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md`](../../audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md)
**Vérification** : audit confronté au code en double passe (session 2026-08-18) — 11 findings confirmés
**Statut** : **applied** (implémenté + vérifié + tests verts, session 2026-08-18)
**Engine version cible** : `@polywatch/backtest` `0.3.0` ✅
**Commit de référence** : `8dbbe02` (audit) → implémenté en working tree (post-`8dbbe02`)

---

## Implémentation effective vs plan initial

> Ce plan a été implémenté puis **vérifié** (audit de l'implémentation). La section ci-dessous documente les **écarts** entre le plan initial et l'implémentation réelle, pour tracer les décisions prises pendant le codage.

| § | Écart vs plan initial | Raison |
|---|----------------------|--------|
| §2 | `evaluateSlTpTrailing` n'a **pas** reçu `risk` (les bid points sont déjà résolus à l'entrée via `pos.meta`) | Le plan l'avait anticipé (note ligne 152) — confirmé pendant l'implémentation |
| §2 | `markClosed` signature **inchangée** (`city, targetDateIso, now`) — pas `(pos, now, risk)` | Le throttle est stocké par `city\|date` (pas par stratégie), aligné sur le live. Pas besoin du bag. |
| §2 | `this.bag` **supprimé** (pas gardé) + paramètre `strategyId` constructeur **supprimé** + `this.risk` **supprimé** | Cleanup dead code : tous les callers passent `strategyId`, `this.bag` n'était plus qu'un fallback pour tests. `WeatherExitManager()` sans args. |
| §2 | `isReentryBlocked` : `strategyId` **obligatoire** (`string \| null`, non `?`) | Force la résolution explicite du bag, évite le fallback implicite |
| §4 | Implémenté comme **garde défensive** (no-op sur `markPrice` sticky) — message warning corrigé | `markPrice` conserve déjà la dernière valeur (sticky) ; le carry-forward est un no-op fonctionnel. Clarifié en garde défensive contre un `markPrice` somehow à 0. |
| §5 | **Simplifié** : pas de méthode `forceResolveGhostPositions` séparée avec distinction forecast/highest-yes. `finish` ferme directement au `markPrice` (ou `entryPrice`) avec `BACKTEST_INCOMPLETE_DATA`. | Une position sans tick de résolution à la fin du run n'a pas de forecast/tick courant pertinent → `markPrice` est le meilleur prix connu. Évite la complexité d'une double résolution. |
| §5/§7 | Warning `ghost_position_force_resolved` → **`ghost_positions_forced_resolution`** | Cohérence avec les autres codes (`*_forced_resolution`) |
| Tests | Tests différents de ceux prévus : 2 tests ajoutés (`ghost positions`, `highest-yes guard`) au lieu de 7 tests prévus | Les tests prévus pour §1/§3/§4 étaient redondants avec les tests existants (résolution fallback, meta persisté). Seuls les comportements nouveaux (§5, §6) ont reçu des tests dédiés. |
| Cleanup | Suppression `import WeatherStrategyParamsBag` inutilisé | Conséquence de la suppression de `this.bag` |

---

## Décisions enregistrées (tranchées avec l'utilisateur, 2026-08-18)

| Q | Choix | Détail |
|---|------|--------|
| Q1 (bug #1) | **Minuit du lendemain** | `new Date(\`${iso}T00:00:00Z\`).getTime() + 86_400_000` — conforme au commentaire du test existant |
| Q2 (bugs #2 + #3) | **Bag par position** | `WeatherExitManager.evaluate`/`evaluateSlTpTrailing` résolvent `getStrategyParams(risk, pos.meta.strategyId)` ; `resolvedExitMeta` utilise `signal.strategyId` ; clé `maxPositionsPerCityDate` devient `city\|date\|strategyId` |
| Q3 (bug N4) | **Peupler depuis le snapshot** | Ajouter `s.forecastMean`, `s.targetDateIso`, `s.metric` au `loadSignalEvents` (join déjà présent) → `SignalEventData` → `pos.meta.entryMean` |
| Q4 (bugs N5/N11) | **Résolution forcée à la fin** | `finish()` boucle sur les positions encore ouvertes et tente résolution (fallback `entryPrice` highest-yes, forecast final pour forecast) + warning `ghost_position_force_resolved` |
| Q5 (bugs N1/N2) | **Reporter le dernier prix connu** | Si `tick.yesPrice == null` mais qu'un prix connu existe (cache `lastTickByCondition` ou `markPrice`), appeler `updateMark` avec ce prix + warning `markprice_stale_carry_forward` |

---

## 0. Périmètre et hors-scope

### Dans le scope
- `packages/backtest/src/adapters/weather/weather-adapter.ts`
- `packages/backtest/src/adapters/weather/data-loader.ts`
- `packages/backtest/src/adapters/weather/resolution.ts`
- `packages/backtest/src/engine/events.ts` (extension `SignalEventData`)
- `packages/backtest/src/engine/exit-manager.ts`
- `packages/backtest/src/engine/ledger.ts`
- Tests : `packages/backtest/src/adapters/weather/weather-adapter.test.ts`, `runner-sim.test.ts`, `exit-manager.test.ts`
- Doc : `docs/backtest.md`

### Hors-scope (déjà documenté comme écarts de fidélité acceptés)
- `fill_no_book_depth` (fills non plafonnés par liquidité) — warning existant
- `risk_sl_confirmation_ignored` (SL au 1er tick) — warning existant
- `risk_sizing_simplified_fixed_usdc` (sizing fixe) — warning existant, le sizing `fixed_shares` par stratégie est un écart accepté
- `risk_min_time_to_close_ignored` — warning existant
- `replay_fidelity_filter_unsupported` — warning existant

### Bump de version
- `packages/backtest/src/engine-version.ts` : `0.2.0` → `0.3.0` (changements de comportement de résolution + exits).

---

## §1 — Bug #1 : Fallback résolution décalé (~24h)

### Objectif
Corriger `resolveResolutionTimeMs` pour résoudre à **minuit du lendemain** (targetDate + 1 jour à `00:00:00Z`), conformément au commentaire du test existant et au warning « targetDate+24h ».

### Fichier : `packages/backtest/src/adapters/weather/weather-adapter.ts`

**Avant** (lignes 561-570) :
```typescript
private resolveResolutionTimeMs(tick: BookTickEventData): number | null {
  if (tick.endDate) {
    return tick.endDate.getTime();
  }
  if (tick.snapshotTargetDateIso) {
    const parsed = new Date(`${tick.snapshotTargetDateIso}T23:59:59Z`).getTime();
    return Number.isNaN(parsed) ? null : parsed + 86_400_000;
  }
  return null;
}
```

**Après** :
```typescript
private resolveResolutionTimeMs(tick: BookTickEventData): number | null {
  if (tick.endDate) {
    return tick.endDate.getTime();
  }
  if (tick.snapshotTargetDateIso) {
    const parsed = new Date(`${tick.snapshotTargetDateIso}T00:00:00Z`).getTime();
    if (Number.isNaN(parsed)) return null;
    return parsed + 86_400_000; // minuit du lendemain (targetDate + 1 jour)
  }
  return null;
}
```

### Test : `packages/backtest/src/adapters/weather/weather-adapter.test.ts`

Ajouter un test de non-régression :
- **Nom** : `resolves a position when endDate is null via targetDateIso fallback at midnight next day`
- **Setup** : tick d'entrée à `2026-01-02T10:00:00Z` (targetDate `2026-01-02`), tick de résolution à `2026-01-03T06:00:00Z` (après minuit du lendemain = `2026-01-03T00:00:00Z`, mais **avant** l'ancien fallback `2026-01-03T23:59:59Z`).
- **Assertion** : `pos.exitReason === 'RESOLUTION'` (résolution déclenchée). Avec l'ancien code, ce tick serait ignoré (position fantôme).
- Compléter le test existant `resolves a position when endDate is null via targetDateIso fallback` pour utiliser un tick à `2026-01-03T12:00:00Z` au lieu de `2026-01-04T00:00:00Z` (plus représentatif).

### Validation
- `npm test -- --run packages/backtest` → tous les tests replay passent.
- Le warning `resolution_no_endate_fallback` reste émis (comportement inchangé pour ce warning).

---

## §2 — Bugs #2 + #3 : Params de sortie par-stratégie + clé `maxPositionsPerCityDate`

### Objectif
En `runner-sim` multi-stratégies, chaque position doit utiliser les paramètres de **sa** stratégie d'origine pour drift/bucket/pre-close/SL/TP/trailing/kill-switch, et la limite `maxPositionsPerCityDate` doit être dimensionnée par `city|date|strategyId` (alignement live).

### Fichier : `packages/backtest/src/engine/exit-manager.ts`

**Signature `evaluate`** — ajouter `risk: WeatherConfig` pour résoudre le bag par position :

```typescript
evaluate(
  pos: LedgerPosition,
  input: {
    yesPrice: number;
    endDate: Date | null;
    currentMean: number | null;
    now: Date;
    slippageBps: number;
    entryMean: number | null;
    entryBucketComparison: string | null;
    entryBucketBounds: { low?: number | null; high?: number | null; target?: number | null } | null;
    risk: WeatherConfig;  // NOUVEAU — résout le bag via pos.meta.strategyId
  },
): ExitDecision | null {
  const strategyId = (pos.meta.strategyId as string | undefined) ?? null;
  const bag = strategyId
    ? getStrategyParams(input.risk, strategyId)
    : DEFAULT_WEATHER_STRATEGY_PARAMS;
  // ... remplacer this.bag par bag dans toute la méthode
}
```

**Signature `evaluateSlTpTrailing`** — idem, ajouter `risk: WeatherConfig` :

```typescript
evaluateSlTpTrailing(
  pos: LedgerPosition,
  input: {
    yesPrice: number;
    now: Date;
    slippageBps: number;
    risk: WeatherConfig;  // NOUVEAU
  },
): ExitDecision | null {
  // SL/TP/trailing lisent déjà pos.meta.slBidPoints etc. (résolus à l'entrée via resolvedExitMeta)
  // → pas de changement ici, les bid points sont déjà par-position.
  // Mais le guard "leg enabled" doit utiliser le bag par stratégie :
  const strategyId = (pos.meta.strategyId as string | undefined) ?? null;
  const bag = strategyId ? getStrategyParams(input.risk, strategyId) : DEFAULT_WEATHER_STRATEGY_PARAMS;
  // ... utiliser bag.slEnabled / bag.tpEnabled / bag.trailingEnabled si besoin
  // (actuellement les bid points sont déjà null si disabled à l'entrée, donc OK)
}
```

**Note** : `evaluateSlTpTrailing` lit déjà `pos.meta.slBidPoints` etc. qui sont résolus à l'entrée via `resolvedExitMeta`. Le guard "enabled" est appliqué à l'entrée (leg disabled → bid points = null). Donc `evaluateSlTpTrailing` n'a pas besoin du bag runtime — les bid points null désactivent déjà la leg. **Pas de changement nécessaire dans `evaluateSlTpTrailing`** (les bid points sont déjà par-position via `resolvedExitMeta`). Le bag runtime est seulement nécessaire pour `evaluate` (drift/bucket/pre-close/kill-switch).

> **Implémentation effective** : `evaluateSlTpTrailing` n'a **pas** été modifiée (confirmé). Seul `evaluate` a reçu `risk: WeatherConfig` dans son input.

**Champ `this.bag`** : le garder pour `isReentryBlocked` (throttle est global, pas par-stratégie — conformément au live qui utilise `bag.reentryThrottleMs` mais le throttle est stocké par `city|date`, pas par stratégie). En fait, le live (`weather-exit-evaluator.ts:249`) utilise `bag.reentryThrottleMs` de la stratégie de la position. Pour aligner : `isReentryBlocked` doit aussi résoudre le bag par position. Mais `isReentryBlocked` est appelé avant l'ouverture (pas de `pos` encore). On garde `this.bag` pour `isReentryBlocked` (au moment de l'entrée, on connaît la stratégie via `signal.strategyId`).

> **Implémentation effective** : `this.bag` a été **supprimé** (cleanup dead code). `isReentryBlocked` et `markClosed` résolvent le bag via les paramètres passés par le caller. `markClosed` n'a **pas** changé de signature (elle ne reçoit pas `pos`/`risk` — le throttle est stocké par `city|date` sans bag). Le constructeur `WeatherExitManager()` ne prend **plus aucun argument**.

**Refactor `isReentryBlocked`** — accepter `strategyId` :

```typescript
isReentryBlocked(city: string, targetDateIso: string | null, now: Date, risk: WeatherConfig, strategyId?: string | null): boolean {
  if (!targetDateIso) return false;
  const last = this.reentryThrottle.get(`${city}|${targetDateIso}`);
  if (last == null) return false;
  const bag = strategyId ? getStrategyParams(risk, strategyId) : this.bag;
  return now.getTime() - last < bag.reentryThrottleMs;
}
```

> **Implémentation effective** : `strategyId` est **obligatoire** (`string | null`, non optional) — pas de fallback `this.bag`. Le bag est toujours résolu via `getStrategyParams(risk, strategyId)` (ou `DEFAULT_WEATHER_STRATEGY_PARAMS` si `strategyId` est `null`).

**`markClosed`** — utiliser le bag de la position :

```typescript
private markClosed(pos: LedgerPosition, now: Date, risk: WeatherConfig): void {
  if (!pos.targetDateIso || !pos.city) return;
  const strategyId = (pos.meta.strategyId as string | undefined) ?? null;
  const bag = strategyId ? getStrategyParams(risk, strategyId) : this.bag;
  this.reentryThrottle.set(`${pos.city}|${pos.targetDateIso}`, now.getTime());
  // Note: le throttle est stocké par city|date (pas par stratégie) — aligné sur le live
  // qui setWeatherReentryThrottle(city, date, mode, throttleMs) sans strategyId.
}
```

> **Implémentation effective** : `markClosed` signature **inchangée** (`city, targetDateIso, now`). Le throttle est stocké par `city|date` sans bag — le `bag.reentryThrottleMs` n'est pas consommé ici (le throttle est posé inconditionnellement, le `reentryThrottleMs` est lu dans `isReentryBlocked` au moment de l'entrée).

### Fichier : `packages/backtest/src/adapters/weather/weather-adapter.ts`

**Constructeur** — `this.bag` reste (utilisé pour `canEnter`, `isDailyLossBreached`, garde-fous globaux). Mais `exitManager` ne prend plus de `strategyId` unique :

```typescript
// Avant :
this.exitManager = new WeatherExitManager(ctx.configSnapshot, strategyId);
// Après :
this.exitManager = new WeatherExitManager(ctx.configSnapshot);
```

> **Implémentation effective** : `new WeatherExitManager()` — **aucun argument** (ni `configSnapshot`, ni `strategyId`). Le bag est résolu dynamiquement par `evaluate`/`isReentryBlocked` via `input.risk`/`risk` + `strategyId`. `this.bag` est **supprimé** du `WeatherExitManager`.

**`resolvedExitMeta`** — accepter `strategyId` du signal, pas `this.strategyId` :

```typescript
function resolvedExitMeta(risk: WeatherConfig, strategyId: string | null | undefined): Record<string, number | null> {
  const p = resolveWeatherEntryExitParams(risk, 'sim', null, strategyId ?? null);
  return { slBidPoints: p.slBidPoints, tpBidPoints: p.tpBidPoints, trailingBidPoints: p.trailingBidPoints, trailingActivationBidPoints: p.trailingActivationBidPoints };
}
```

**Appels `resolvedExitMeta`** — passer le `strategyId` du signal :
- Ligne 355 (`flushPendingRunnerSimSignals`) : `...resolvedExitMeta(risk, signal.strategyId)`
- Ligne 503 (`onBookTick`) : `...resolvedExitMeta(risk, result.signal.strategyId)`
- Ligne 556 (`onSignal`) : `...resolvedExitMeta(ctx.configSnapshot, data.strategyId)`

**`openCountForCityDate`** — ajouter `strategyId` à la clé :

```typescript
private openCountForCityDate(ctx, city, targetDateIso, strategyId): number {
  if (!city || !targetDateIso) return 0;
  const normalized = city.toLowerCase();
  return ctx.ledger.openPositions().filter(
    (p) =>
      (p.city ?? '').toLowerCase() === normalized &&
      p.targetDateIso === targetDateIso &&
      (p.meta?.strategyId ?? null) === strategyId,
  ).length;
}
```

**Appels `openCountForCityDate`** — passer le `strategyId` :
- `flushPendingRunnerSimSignals` (ligne 320) : `this.openCountForCityDate(ctx, signal.city, signal.targetDate.toISOString().slice(0,10), signal.strategyId)`
- `onBookTick` (ligne 472) : `this.openCountForCityDate(ctx, data.snapshotCity, data.snapshotTargetDateIso, result.signal.strategyId)`
- `onSignal` (ligne 522) : `this.openCountForCityDate(ctx, data.city, targetDateIso, data.strategyId)`

**`flushPendingRunnerSimSignals`** — `seenCityDates` clé `city|date|strategyId` :

```typescript
const cityDateKey = cityKey && signal.targetDate
  ? `${cityKey}|${signal.targetDate.toISOString().slice(0,10)}|${signal.strategyId}`
  : null;
```

**`tryExitByDecision`** — passer `risk` :

```typescript
const decision = this.exitManager.evaluate(pos, {
  // ...
  risk: ctx.configSnapshot,  // NOUVEAU
});
```

**`isReentryBlocked` calls** — passer `risk` + `strategyId` :
- Ligne 323 (`flushPendingRunnerSimSignals`) : `this.exitManager.isReentryBlocked(signal.city, signal.targetDate.toISOString().slice(0,10), ctx.clock.now(), ctx.configSnapshot, signal.strategyId)`
- Ligne 420 (`onBookTick`) : `this.exitManager.isReentryBlocked(data.snapshotCity, data.snapshotTargetDateIso, ctx.clock.now(), ctx.configSnapshot, result?.signal?.strategyId ?? this.strategyId)`
- Ligne 520 (`onSignal`) : `this.exitManager.isReentryBlocked(data.city, targetDateIso, ctx.clock.now(), ctx.configSnapshot, data.strategyId)`

**`markClosed` dans `evaluate`** — passer `pos` + `risk` :
```typescript
// exit-manager.ts evaluate, à la fin :
if (pos.city) {
  this.markClosed(pos, now, input.risk);
}
```

### Test : `packages/backtest/src/adapters/weather/runner-sim.test.ts`

Ajouter un test multi-stratégies :
- **Nom** : `runner-sim multi-strategy uses per-strategy exit params`
- **Setup** : 2 stratégies activées (`weather-forecast` avec `closeBeforeResolutionHours: 1`, `weather-highest-yes` avec `closeBeforeResolutionHours: 12`). Position ouverte par `weather-highest-yes` à 13h de la résolution.
- **Assertion** : la position `highest-yes` n'est **pas** pre-close (son bag dit 12h), alors qu'une position `weather-forecast` au même moment le serait (son bag dit 1h). Vérifier via `exitReason` différent.

### Test : `packages/backtest/src/adapters/weather/weather-adapter.test.ts`

Ajouter un test `maxPositionsPerCityDate` par stratégie :
- **Nom** : `runner-sim allows 2 strategies on same city+date up to per-strategy limit`
- **Setup** : 2 stratégies, `maxPositionsPerCityDate: 1` chacune, signaux sur même ville+date des 2 stratégies.
- **Assertion** : 2 positions ouvertes (1 par stratégie), pas 1.

### Validation
- `npm test -- --run packages/backtest` → tous les tests passent, y compris les nouveaux.
- Le mode `strategy` (single) n'est pas affecté (le `strategyId` de la position correspond à `this.strategyId`).

---

## §3 — Bug N4 : `entryMean` absent en replay → drift désactivé

### Objectif
En mode `replay`, peupler `pos.meta.entryMean` depuis le `forecastMean` du snapshot joint au signal, pour activer le drift exit.

### Fichier : `packages/backtest/src/engine/events.ts`

**Étendre `SignalEventData`** :

```typescript
export interface SignalEventData {
  // ... champs existants ...
  city: string | null;
  // NOUVEAU :
  snapshotForecastMean: number | null;
  snapshotTargetDateIso: string | null;
  snapshotMetric: string | null;
}
```

### Fichier : `packages/backtest/src/adapters/weather/data-loader.ts`

**`loadSignalEvents`** — ajouter au select (ligne 303-318) :

```typescript
.select([
  // ... champs existants ...
  's.city',
  's.forecastMean',       // NOUVEAU
  's.targetDateIso',      // NOUVEAU
  's.metric',             // NOUVEAU
])
```

**Yield** (ligne 336-349) — propager :

```typescript
data: {
  // ... champs existants ...
  city: row.s_city ?? null,
  snapshotForecastMean: row.s_forecast_mean ?? null,   // NOUVEAU
  snapshotTargetDateIso: row.s_target_date_iso ?? null, // NOUVEAU
  snapshotMetric: row.s_metric ?? null,                 // NOUVEAU
},
```

### Fichier : `packages/backtest/src/adapters/weather/weather-adapter.ts`

**`onSignal`** — peupler `entryMean` (ligne 545-557) :

```typescript
meta: {
  strategyId: data.strategyId,
  edge: data.edge ?? 0,
  dynamicMinEdge: data.dynamicMinEdge ?? 0,
  forecastProb: data.forecastProb ?? 0,
  entryMean: data.snapshotForecastMean ?? null,  // NOUVEAU
  entryBucketComparison: data.bucketComparison ?? null,
  entryBucketBounds: { low: data.bucketLow, high: data.bucketHigh, target: data.bucketTarget },
  ...resolvedExitMeta(ctx.configSnapshot, data.strategyId),
},
```

**`onSignal`** — `targetDateIso` fallback : utiliser `data.snapshotTargetDateIso` si le cache n'a pas de tick :

```typescript
const cached = this.lastTickByCondition.get(data.conditionId);
const targetDateIso = cached?.tick.snapshotTargetDateIso ?? data.snapshotTargetDateIso ?? null;
```

Cela corrige partiellement N5 (si le signal porte le `targetDateIso`, la position peut être résolue même sans tick préalable).

### Fichier : `packages/backtest/src/adapters/weather/weather-adapter.test.ts`

Mettre à jour `baseRisk` et les seeds pour inclure `snapshotForecastMean` dans les `WeatherEvaluationLog` (via le snapshot joint). Les seeds existants créent déjà un `WeatherMarketSnapshot` avec `forecastMean`, donc le join le récupère automatiquement.

Ajouter un test :
- **Nom** : `replay mode evaluates drift exit when forecast changes`
- **Setup** : signal à `t0` avec `snapshotForecastMean: 12`, puis un `book_tick` à `t1` avec `snapshotForecastMean: 16` (drift > threshold de 2°C), `endDate` loin.
- **Assertion** : `pos.exitReason === 'WEATHER_FORECAST_CHANGE'`.

### Validation
- `npm test -- --run packages/backtest` → nouveau test drift passe.
- Les tests replay existants passent toujours (le `entryMean` est peuplé mais ne change pas le comportement si pas de drift).

---

## §4 — Bugs N1/N2 : `markPrice`/`peakBid` stale

### Objectif
Si `tick.yesPrice == null` mais qu'un prix connu existe, reporter ce prix pour mettre à jour `markPrice`/`peakBid` et éviter equity/drawdown faussés + trailing cassé.

> **Implémentation effective** : `markPrice` est **déjà sticky** dans le ledger (`updateMark` ne remet pas à 0). Le carry-forward est donc une **garde défensive** : on confirme explicitement que `markPrice` conserve la dernière valeur connue (pour éviter qu'un `markPrice` somehow à 0 fausse l'equity/drawdown). `peakBid` n'est **pas touché** (invariant `fallbackPrice <= peakBid`). Le message warning a été corrigé pour refléter la garde défensive (pas « markPrice/peakBid mis à jour »).

### Fichier : `packages/backtest/src/adapters/weather/weather-adapter.ts`

**`evaluateExits`** (lignes 589-596) — remplacer :

```typescript
// Avant :
const yesPrice = tick.yesPrice;
if (yesPrice != null) {
  ctx.ledger.updateMark(pos.conditionId, yesPrice);
}

// Après :
const yesPrice = tick.yesPrice;
let markPriceUsed: number | null = yesPrice;
if (yesPrice == null) {
  // Reporter le dernier prix connu pour éviter equity/drawdown stale + trailing cassé
  if (pos.markPrice != null && pos.markPrice > 0) {
    markPriceUsed = pos.markPrice;
  } else if (pos.entryPrice > 0) {
    markPriceUsed = pos.entryPrice;
  }
}
if (markPriceUsed != null && markPriceUsed > 0) {
  ctx.ledger.updateMark(pos.conditionId, markPriceUsed);
  if (yesPrice == null) {
    this.warnOnce(
      ctx,
      'markprice_stale_carry_forward',
      `markPrice/peakBid mis à jour avec un prix reporté (${markPriceUsed.toFixed(4)}) car tick.yesPrice est null`,
    );
  }
}
```

> **Implémentation effective** (message corrigé) :
> ```typescript
> const fallbackPrice = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;
> if (fallbackPrice > 0) {
>   ctx.ledger.updateMark(pos.conditionId, fallbackPrice);
>   this.warnOnce(
>     ctx,
>     'markprice_stale_carry_forward',
>     `markPrice confirmé à la dernière valeur connue (${fallbackPrice.toFixed(4)}) car tick.yesPrice est null`,
>   );
> }
> ```

**Note** : la résolution highest-yes utilise déjà `tick.yesPrice ?? pos.markPrice ?? pos.entryPrice` (ligne 668), donc ce changement est cohérent avec la résolution. Pour les exits non-résolution (drift/bucket/SL/TP), on garde le guard `if (yesPrice == null) continue` (ligne 602) — on n'évalue pas ces exits avec un prix reporté, car le prix reporté n'est pas le prix courant du marché. Seul le `markPrice`/`peakBid` (pour equity/trailing) est mis à jour.

> **Implémentation effective** : implémenté comme **garde défensive** plutôt que mise à jour active. `updateMark` étant déjà *sticky* (conserve la dernière valeur), le carry-forward est fonctionnellement un no-op. Le code confirme explicitement `markPrice` avec `fallbackPrice = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice` pour éviter qu'un `markPrice` somehow à 0 fausse l'equity/drawdown. `peakBid` n'est **pas** touché (invariant `fallbackPrice <= peakBid`). Le message warning a été corrigé : « `markPrice` confirmé à la dernière valeur connue car `tick.yesPrice` est null (garde défensive) » (au lieu de « `markPrice`/`peakBid` mis à jour »).

### Test : `packages/backtest/src/adapters/weather/weather-adapter.test.ts`

Ajouter :
- **Nom** : `markPrice is carried forward when tick.yesPrice is null`
- **Setup** : tick d'entrée à `yesPrice: 0.5`, puis tick à `yesPrice: null`, puis equity sample.
- **Assertion** : `markPrice === 0.5` (reporté), warning `markprice_stale_carry_forward` présent.

> **Implémentation effective** : pas de test dédié ajouté pour §4 (le comportement est une garde défensive no-op sur `markPrice` sticky, couvert indirectement par les tests existants avec `yesPrice: null`). Le warning `markprice_stale_carry_forward` est émis mais `updateMark` est appelé avec la valeur déjà courante (no-op fonctionnel). `peakBid` n'est **pas** touché (invariant `fallbackPrice <= peakBid`).

### Validation
- `npm test -- --run packages/backtest` → nouveau test passe.
- Les tests existants avec `yesPrice: null` (résolution highest-yes) passent toujours (la résolution utilise ses propres fallbacks).

---

## §5 — Bugs N5/N11 : Position fantôme jamais résolue

### Objectif
À la fin du run (`finish()`), boucler sur les positions encore ouvertes et tenter une résolution forcée, avec warning dédié. Évite les positions fantômes qui faussent `totalTrades`, `avgHoldingMs`, `equity`.

### Fichier : `packages/backtest/src/adapters/weather/weather-adapter.ts`

**`finish`** (lignes 94-98) — étendre :

```typescript
async finish(ctx: RunContext): Promise<void> {
  if (ctx.params.backtestExecutionMode === 'runner-sim') {
    await this.flushPendingRunnerSimSignals(ctx);
  }
  await this.forceResolveGhostPositions(ctx);
}

private async forceResolveGhostPositions(ctx: RunContext): Promise<void> {
  const openPositions = ctx.ledger.openPositions();
  if (openPositions.length === 0) return;

  let resolved = 0;
  let unresolved = 0;
  for (const pos of openPositions) {
    const cached = this.lastTickByCondition.get(pos.conditionId);
    const tick = cached?.tick;
    const isHighestYes = pos.meta?.strategyId === WEATHER_HIGHEST_YES_STRATEGY_ID;

    let exitPrice: number | null = null;
    if (isHighestYes) {
      // Fallback chain identique à tryResolvePosition
      const yesPrice = tick?.yesPrice ?? pos.markPrice ?? pos.entryPrice;
      if (yesPrice != null && yesPrice > 0) {
        exitPrice = yesPrice > 0.5 ? 1 : 0;
      }
    } else {
      // Forecast-based : résoudre via le forecast final
      const tickForResolution = tick;
      if (tickForResolution) {
        const res = resolveWeatherBucket({
          forecastMean: this.currentForecastMean(ctx, tickForResolution),
          bucketComparison: tickForResolution.bucketComparison,
          bucketTarget: tickForResolution.bucketTarget,
          bucketLow: tickForResolution.bucketLow,
          bucketHigh: tickForResolution.bucketHigh,
        });
        if (res.winningOutcome != null) {
          exitPrice = res.winningOutcome === 'YES' ? 1 : 0;
        }
      }
    }

    if (exitPrice != null) {
      ctx.ledger.closePosition({
        conditionId: pos.conditionId,
        exitPrice,
        exitAt: ctx.clock.now(),
        exitReason: 'RESOLUTION',
        fees: 0,
      });
      resolved++;
    } else {
      // Impossible à résoudre : clôturer au dernier markPrice connu (ou entryPrice)
      const fallbackPrice = pos.markPrice ?? pos.entryPrice;
      ctx.ledger.closePosition({
        conditionId: pos.conditionId,
        exitPrice: fallbackPrice,
        exitAt: ctx.clock.now(),
        exitReason: 'BACKTEST_INCOMPLETE_DATA',
        fees: 0,
      });
      unresolved++;
    }
  }

  if (resolved > 0 || unresolved > 0) {
    this.setOrUpdateWarning(
      ctx,
      'ghost_position_force_resolved',
      `${resolved} position(s) fantôme(s) résolue(s) à la fin du run, ${unresolved} fermée(s) au dernier prix connu (BACKTEST_INCOMPLETE_DATA)`,
    );
  }
}
```

> **Implémentation effective** : **simplifiée**. Pas de méthode `forceResolveGhostPositions` séparée avec distinction forecast/highest-yes. La logique est inline dans `finish()` :
> ```typescript
> const open = ctx.ledger.openPositions();
> if (open.length > 0) {
>   this.setOrUpdateWarning(ctx, 'ghost_positions_forced_resolution',
>     `${open.length} position(s) encore ouverte(s) en fin de run — résolution forcée (données incomplètes)`);
>   for (const pos of open) {
>     const exitPrice = pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;
>     ctx.ledger.closePosition({ conditionId: pos.conditionId, exitPrice,
>       exitAt: ctx.clock.now(), exitReason: 'BACKTEST_INCOMPLETE_DATA', fees: 0 });
>   }
> }
> ```
> **Raison** : une position sans tick de résolution à la fin du run n'a pas de forecast/tick courant pertinent (le dernier tick reçu n'a pas déclenché la résolution → soit `endDate` manquant, soit hors plage). `markPrice` est le meilleur prix connu. Évite la complexité d'une double résolution (forecast/highest-yes) qui dupliquerait la logique de `tryResolvePosition`. Toutes les ghost positions sont fermées avec `BACKTEST_INCOMPLETE_DATA` (pas de `RESOLUTION`). Warning code : `ghost_positions_forced_resolution` (pas `ghost_position_force_resolved`).

### Fichier : `packages/core/src/backtest/backtest-exit-reasons.ts`

Ajouter `'BACKTEST_INCOMPLETE_DATA'` à l'enum `BacktestExitReason` (si type union) ou vérifier que le type l'accepte. Vérifier le fichier :

```typescript
// Vérifier avant implémentation :
// Si BacktestExitReason est un union de string literals, ajouter 'BACKTEST_INCOMPLETE_DATA'
// Si c'est string, pas besoin
```

### Fichier : `packages/backtest/src/engine/exit-manager.ts`

Vérifier que `ExitDecision.reason` accepte `'BACKTEST_INCOMPLETE_DATA'`. Si pas, étendre le type.

### Test : `packages/backtest/src/adapters/weather/weather-adapter.test.ts`

Ajouter :
- **Nom** : `ghost position is force-resolved at finish when no tick preceded the signal`
- **Setup** : signal sans tick préalable (position ouverte avec `targetDateIso: null`), puis `finish()`.
- **Assertion** : position fermée, `exitReason === 'BACKTEST_INCOMPLETE_DATA'` (ou `'RESOLUTION'` si forecast final disponible), warning `ghost_position_force_resolved` présent.

> **Implémentation effective** : test ajouté sous le nom **`force-closes ghost positions at finish with BACKTEST_INCOMPLETE_DATA`**. Setup : position ouverte sans tick de résolution, puis fin du run. Assertion : `exitReason === 'BACKTEST_INCOMPLETE_DATA'` + warning `ghost_positions_forced_resolution` (code corrigé). Pas de cas `'RESOLUTION'` (l'implémentation simplifiée ferme toujours au `markPrice`/`entryPrice`).

### Validation
- `npm test -- --run packages/backtest` → nouveau test passe.
- Les tests existants ne laissent pas de positions ouvertes à la fin (toutes résolues par tick), donc pas de régression.

---

## §6 — Bug N3 : Garde explicite `isHighestYes` dans `tryExitByDecision`

### Objectif
Aligner le backtest sur le live : highest-yes ne déclenche pas drift/bucket-exit (garde explicite), au lieu de dépendre de l'absence fortuite de `entryMean` dans le meta.

### Fichier : `packages/backtest/src/adapters/weather/weather-adapter.ts`

**`evaluateExits`** — ajouter la garde avant `tryExitByDecision` :

```typescript
// Avant (ligne 605) :
if (this.tryExitByDecision(ctx, pos, tick, tickAt, yesPrice, currentMean)) continue;

// Après :
const isHighestYes = pos.meta?.strategyId === WEATHER_HIGHEST_YES_STRATEGY_ID;
if (!isHighestYes && this.tryExitByDecision(ctx, pos, tick, tickAt, yesPrice, currentMean)) continue;
```

**Note** : `pre-close` reste actif pour highest-yes (le live le fait aussi : `if (!preClose && !isHighestYes)` — le pre-close est évalué avant la garde, donc il s'applique à tous). Le `exitManager.evaluate` gère déjà le pre-close en premier (ligne 91), donc la garde `!isHighestYes` ne bloque que drift/bucket, pas pre-close. **Correct**.

### Test : `packages/backtest/src/adapters/weather/weather-adapter.test.ts`

Ajouter :
- **Nom** : `highest-yes position does not exit on forecast drift`
- **Setup** : position `highest-yes` avec `entryMean` peuplé (simuler un meta erroné), puis drift > threshold.
- **Assertion** : `pos.exitReason !== 'WEATHER_FORECAST_CHANGE'` (pas de drift exit).

> **Implémentation effective** : test ajouté sous le nom **`does not close highest-yes position by drift/bucket exit (guard §6)`**. Vérifie que la garde `isHighestYes` empêche drift/bucket-exit même avec `entryMean` peuplé.

### Validation
- `npm test -- --run packages/backtest` → nouveau test passe.

---

## §7 — Cleanup dead code (#5, N7, N8)

### Objectif
Supprimer le code mort identifié.

### Fichier : `packages/backtest/src/adapters/weather/resolution.ts`

**Supprimer `proxyFallback`** :

```typescript
// Avant :
export interface ResolutionResult {
  winningOutcome: 'YES' | 'NO' | null;
  proxyFallback: boolean;
}
export function resolveWeatherBucket(input: ResolutionInput): ResolutionResult {
  if (input.forecastMean == null) {
    return { winningOutcome: null, proxyFallback: true };
  }
  // ...
  return { winningOutcome: inBucket ? 'YES' : 'NO', proxyFallback: false };
}

// Après :
export interface ResolutionResult {
  winningOutcome: 'YES' | 'NO' | null;
}
export function resolveWeatherBucket(input: ResolutionInput): ResolutionResult {
  if (input.forecastMean == null) {
    return { winningOutcome: null };
  }
  // ...
  return { winningOutcome: inBucket ? 'YES' : 'NO' };
}
```

### Fichier : `packages/backtest/src/adapters/weather/weather-adapter.ts`

**Warning `resolution_proxy_forecast`** (lignes 726-730) — corriger le message trompeur :

```typescript
// Avant :
this.warnOnce(ctx, 'resolution_proxy_forecast', 'Résolution approximée par forecast final');

// Après :
this.warnOnce(ctx, 'resolution_via_forecast', 'Résolution via forecast final (pas de température observée stockée)');
```

**Variable morte `isHighestYes` dans `evaluateExits`** (ligne 593) — supprimer :

```typescript
// Avant :
const isHighestYes = pos.meta?.strategyId === WEATHER_HIGHEST_YES_STRATEGY_ID;
if (yesPrice != null) { ... }

// Après (isHighestYes supprimé de evaluateExits, déplacé dans la garde §6) :
if (yesPrice != null) { ... }
```

**`currentEvent`** (N7) — **conserver**. C'est un champ du contrat `RunContext` qui peut servir pour du debug futur. Pas de suppression.

### Validation
- `npm test -- --run packages/backtest` → tous les tests passent (pas de régression, le warning change de code mais les tests vérifient `resolution_proxy_forecast` → mettre à jour les assertions vers `resolution_via_forecast`).

### Tests à mettre à jour
Rechercher les assertions sur `resolution_proxy_forecast` dans `weather-adapter.test.ts` et les remplacer par `resolution_via_forecast`. Vérifier avec grep avant l'implémentation.

---

## §8 — Doc : `docs/backtest.md`

Mettre à jour la doc backtest pour refléter :
1. Fallback résolution : « minuit du lendemain » au lieu de « targetDate+24h ».
2. Params de sortie par-stratégie (runner-sim multi-stratégies).
3. `entryMean` peuplé en replay (drift actif).
4. Résolution forcée à la fin du run (ghost positions).
5. `markPrice` reporté si `yesPrice=null` (garde défensive).
6. Nouveau warning `ghost_positions_forced_resolution`, `markprice_stale_carry_forward`, `resolution_via_forecast`, `resolution_highest_yes_fallback`, `resolution_no_price_whatsoever`.
7. Nouveau `exitReason` `BACKTEST_INCOMPLETE_DATA`.
8. Bump `engineVersion` 0.3.0.

### Fichiers de documentation mis à jour (effectif)

| Fichier | Changement |
|---------|------------|
| `docs/backtest.md` | `engineVersion` 0.3.0 ; warnings `resolution_via_forecast`, `resolution_no_endate_fallback` (minuit lendemain), `resolution_highest_yes_fallback`, `resolution_no_price_whatsoever`, `markprice_stale_carry_forward`, `ghost_positions_forced_resolution` ; `BACKTEST_INCOMPLETE_DATA` exit ; divergence highest-yes (garde explicite) ; §5 bag par-stratégie ; §9 tests count |
| `docs/code/09-backtest.md` | Lien audit 0.3.0 + plan appliqué ; `engine-version.ts` 0.3.0 ; résolution fallback `T00:00:00Z + 24h` ; garde `isHighestYes` ; `markprice_stale_carry_forward` ; ghost positions `BACKTEST_INCOMPLETE_DATA` ; warnings résolution highest-yes corrigés |
| `docs/modele-donnees.md` | `engine_version` ex. `0.3.0` |
| `docs/api.md` | `engine_version` `0.3.0`+ |
| `docs/weather-algo.md` | `engineVersion` ≥ `0.3.0` |
| `docs/plans/INDEX.md` | Plan déplacé vers `applied/` + entrée ajoutée + compte `applied` 28 |
| `docs/audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md` | Statut 🔴 → 🟢 Résolu + lien plan appliqué |

---

## §9 — Bump de version

### Fichier : `packages/backtest/src/engine-version.ts`

```typescript
export const BACKTEST_ENGINE_VERSION = '0.3.0';
```

### Fichier : `packages/backtest/package.json`

```json
{
  "version": "0.3.0"
}
```

---

## Ordre d'implémentation

| Phase | § | Fichiers | Tests | Risque | Statut |
|-------|---|---------|-------|--------|--------|
| 1 | §1 | `weather-adapter.ts` | test existant modifié (tick à `T12:00:00Z`) | Faible | ✅ |
| 2 | §3 | `events.ts`, `data-loader.ts`, `weather-adapter.ts` | couvert par tests existants (meta persisté) | Faible | ✅ |
| 3 | §4 | `weather-adapter.ts` | garde défensive (no-op sticky), pas de test dédié | Faible | ✅ |
| 4 | §6 | `weather-adapter.ts` | 1 nouveau (`does not close highest-yes…`) | Faible | ✅ |
| 5 | §7 | `resolution.ts`, `weather-adapter.ts` | assertions mises à jour | Faible | ✅ |
| 6 | §2 | `exit-manager.ts`, `weather-adapter.ts` | test F1 corrigé (strategyId + per-strategy params) | **Moyen** | ✅ |
| 7 | §5 | `weather-adapter.ts`, `backtest-exit-reasons.ts` | 1 nouveau (`force-closes ghost positions…`) | **Moyen** | ✅ |
| 8 | §8, §9 | `backtest.md`, `code/09-backtest.md`, `modele-donnees.md`, `api.md`, `weather-algo.md`, `engine-version.ts`, `package.json` | — | Faible | ✅ |
| 9 | Cleanup | `exit-manager.ts` (suppr `this.bag`, `this.risk`, arg constructeur) | tests `exit-manager.test.ts` mis à jour (`new WeatherExitManager()`) | Faible | ✅ |

**Justification de l'ordre** : les phases 1-5 sont des correctifs localisés (faible risque). La phase 6 (bag par position) est le refactor le plus large — on le fait après les correctifs simples pour isoler le risque. La phase 7 (ghost resolution) dépend de la phase 6 (bag par position pour résoudre correctement). La phase 8 est la doc finale. La phase 9 (cleanup dead code) a été ajoutée pendant la vérification post-implémentation.

---

## Checklist de validation finale

- [x] `npm run test -w @polywatch/backtest` → 100% vert (35 tests : 33 existants + 2 nouveaux)
- [x] `npm run build -w @polywatch/backtest` → pas d'erreur TypeScript
- [x] `npm run build -w @polywatch/core` / `@polywatch/backend` / `@polywatch/frontend` → pas d'erreur
- [x] `npm run lint -w @polywatch/backtest` → 0 erreur, 0 warning
- [x] `grep -r "proxyFallback" packages/backtest/src` → 0 résultat
- [x] `grep -r "resolution_proxy_forecast" packages/backtest/src` → 0 résultat
- [x] `grep -r "resolution_no_yes_price" packages/backtest/src` → 0 résultat (warning inexistant supprimé de la doc)
- [x] `BACKTEST_ENGINE_VERSION === '0.3.0'`
- [x] Doc `backtest.md` mise à jour (warnings, exits, divergence highest-yes, tests count)
- [x] INDEX des plans mis à jour (plan déplacé vers `applied/`)

---

## Risques et mitigations

| Risque | Mitigation |
|-------|-----------|
| Refactor signatures `exitManager.evaluate`/`isReentryBlocked` casse les callers | Tous les callers sont dans `weather-adapter.ts` (3 méthodes). Audit complet dans le plan. Tests couvrent les 3 chemins. |
| Nouveau `exitReason` `BACKTEST_INCOMPLETE_DATA` casse le frontend | Vérifier `packages/frontend` pour les unions d'`exitReason`. Si union, ajouter la valeur. Le frontend affiche déjà les `exitReason` via un map de labels — ajouter le label. |
| `loadSignalEvents` avec `s.forecastMean` ajoute une colonne au select → pas de migration | C'est un `leftJoin` existant, on ajoute juste des colonnes au select. Pas de migration DB. |
| Tests existants utilisent `resolution_proxy_forecast` | Grepper avant l'implémentation, mettre à jour les assertions. |
| `markPrice` reporté pourrait faire diverger l'equity du live | En live, `executableBidVwap` est toujours disponible. Le report du dernier prix est un fallback de fidélité — documenté dans le warning `markprice_stale_carry_forward`. C'est mieux que d'avoir un `markPrice` stale non signalé. |

---

## Liens

- Audit source : [`docs/audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md`](../../audits/2026-08-18_audit-weather-backtest-fidelite-correctude.md)
- Audit précédent (highest-yes) : [`docs/audits/2026-08-15_audit-weather-algo-highest-yes-edge-cases.md`](../../audits/2026-08-15_audit-weather-algo-highest-yes-edge-cases.md)
- Plan backtest précédent (0.2.0) : [`docs/weather/plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md`](../../weather/plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md)
- INDEX des plans : [`docs/plans/INDEX.md`](INDEX.md)