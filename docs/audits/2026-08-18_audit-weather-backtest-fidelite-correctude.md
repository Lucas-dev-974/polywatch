# Audit Weather Backtest — Cohérence / Correctitude / Bugs fantômes

**Date** : 2026-08-18
**Auteur** : Assistant IA (analyse automatisée, confrontation au code en deux passes)
**Statut** : 🟢 **Résolu** — 11 findings corrigés (plan appliqué, [`docs/plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md`](../plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md), `engineVersion` 0.3.0)
**Commit de référence** : `8dbbe02` (refactor(weather-algo): split WeatherTimelineView)
**Périmètre** : `packages/backtest/src/**` + dépendances `packages/core/src/weather/**`, `packages/core/src/risk/**`, `packages/weather-algo/src/strategy/**`

---

## 📋 Résumé exécutif

Audit en double passe du moteur de backtest weather (mode `reevaluate`, `replay`, `runner-sim`). L'architecture générale est saine (horloge virtuelle déterministe, fusion k-way paginée, fidelity warnings explicites), mais on identifie **11 défauts** répartis en trois familles :

| Famille | # | Gravité | Impact |
|---------|---|---------|--------|
| **Bugs de correctitude** | #1, #2, #3, N4 | 🔴/🟠 | Résultats faussés (timing résolution, exits multi-stratégies, drift replay) |
| **Bugs fantômes** | N1, N2, N5, N11 | 🟠/🟡 | Stats silencieusement incorrectes, positions jamais fermées |
| **Dead code / incohérences** | #5, N3, N7, N8 | 🟡 | Maintenance, fragilité future |

Les décisions de fix ont été tranchées avec l'utilisateur (voir [`docs/plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md`](../plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md)).

---

## ✅ Ce qui est bien fait (référence positive)

1. **Déterminisme strict** — `VirtualClock.advanceTo` (`engine/virtual-clock.ts:25`) jette sur régression temporelle. Le runner ne contient aucun `Date.now()` dans le chemin moteur. Base solide pour reproductibilité.

2. **Fusion k-way correcte** — `engine/merge-event-streams.ts` : tas binaire avec `bubbleUp` à l'insertion (commentaire ligne 40 documente le bug évité). La pagination keyset `(time, id)` du `data-loader.ts` est alignée sur la clé de fusion — pas de régression d'horloge possible.

3. **Fidélité documentée** — `emitStaticFidelityWarnings` (`weather-adapter.ts:127`) liste honnêtement les simplifications : pas de profondeur de carnet, sizing fixe, SL sans ticks de confirmation, `minTimeToClose` ignoré, `detectionDelayMs` non appliqué, `fidelityMinutes` ignoré en replay. Excellente pratique.

4. **Résolution robuste highest-yes** — chaîne de fallback `tick.yesPrice → markPrice → entryPrice` (`weather-adapter.ts:668`) avec warnings dédiés. Tests couvrent les 3 cas (`weather-adapter.test.ts:545-733`).

5. **Séparation moteur/adapter** — `engine/` est générique, l'adapter weather est isolé. `ClockedWeatherStrategy` injecte proprement l'horloge virtuelle.

6. **Tests de qualité** — `weather-adapter.test.ts` couvre replay, résolution, fallbacks, `maxConcurrentPositions`, métriques non supportées ; `runner-sim.test.ts` couvre la sélection de groupe.

---

## 🔴 PROBLÈME #1 — Fallback de résolution décalé de ~24h quand `endDate` est null

### Localisation
`packages/backtest/src/adapters/weather/weather-adapter.ts:561-570` (`resolveResolutionTimeMs`)

### Code actuel
```typescript
private resolveResolutionTimeMs(tick: BookTickEventData): number | null {
  if (tick.endDate) {
    return tick.endDate.getTime();
  }
  if (tick.snapshotTargetDateIso) {
    const parsed = new Date(`${tick.snapshotTargetDateIso}T23:59:59Z`).getTime();
    return Number.isNaN(parsed) ? null : parsed + 86_400_000;  // ❌ double offset
  }
  return null;
}
```

### Analyse
`T23:59:59Z + 86_400_000ms` = **lendemain à 23:59:59Z** (≈ 48h après minuit UTC du `targetDate`). Or :
- Le commentaire du test `weather-adapter.test.ts:369` dit « targetDateIso+24h = 2026-01-03 » pour un targetDate `2026-01-02`, suggérant que l'intention est **minuit du lendemain** (`2026-01-03T00:00:00Z`).
- Le warning émis ligne 658-661 dit « fallback targetDate+24h » — l'intention documentée est donc `targetDate + 1 jour`.

Conséquence : les positions sans `endDate` sont tenues ~24h de trop. Un tick à `targetDate+1j 12:00` (après la vraie résolution) ne déclenche pas la résolution du backtest, alors qu'en live le marché aurait déjà résolu.

### Test qui masque le bug
`weather-adapter.test.ts:347-407` (« resolves a position when endDate is null via targetDateIso fallback ») passe par accident : le tick de résolution est à `2026-01-04T00:00:00Z`, postérieur au fallback erroné (`2026-01-03T23:59:59Z`). Un tick à `2026-01-03T12:00:00Z` échouerait silencieusement (position reste ouverte).

### Décision
**Minuit du lendemain** (`new Date(`${iso}T00:00:00Z`).getTime() + 86_400_000`). Voir plan §1.

---

## 🔴 PROBLÈME #2 — Paramètres de sortie par-stratégie ignorés en `runner-sim` multi-stratégies

### Localisation
`packages/backtest/src/adapters/weather/weather-adapter.ts:78-92` (constructeur) + lignes 355, 503, 556 (`resolvedExitMeta`)

### Code actuel
```typescript
constructor(ctx: RunContext) {
  const strategyId = (ctx.params.strategyId ?? WEATHER_FORECAST_STRATEGY_ID) as WeatherStrategyId;
  this.strategyId = strategyId;
  this.bag = getStrategyParams(ctx.configSnapshot, strategyId);          // ❌ un seul bag
  // ...
  this.exitManager = new WeatherExitManager(ctx.configSnapshot, strategyId);  // ❌ un seul bag
}
```

```typescript
// Lignes 355, 503, 556 :
...resolvedExitMeta(risk, this.strategyId),  // ❌ toujours this.strategyId
```

### Analyse
En `runner-sim` multi-stratégies (`backtestExecutionMode: 'runner-sim'` sans `strategyId` override), `createRunnerSimStrategies` instancie **toutes** les stratégies activées. Mais :
- `this.bag` est résolu une fois avec `this.strategyId` (override ou `weather-forecast` par défaut).
- `this.exitManager` est construit avec ce même `strategyId` unique.
- `resolvedExitMeta` (SL/TP/trailing bid points stockés dans `pos.meta`) utilise `this.strategyId`, pas le `strategyId` du signal émetteur.

Une position ouverte par `weather-highest-yes` ou `weather-forecast-aligned` sera donc gérée avec les paramètres de sortie de `weather-forecast` :
- `closeBeforeResolutionHours` erroné → pre-close trop tôt/tard.
- `forecastChangeThreshold` erroné → drift mal évalué.
- `bucketHysteresisPolls`, `reentryThrottleMs`, `cityFollowSwitchMode`, `killSwitchAction` erronés.
- `slBidPoints`/`tpBidPoints`/`trailingBidPoints` erronés (via `resolvedExitMeta`).

### Sévérité
- En mode `strategy` (défaut) avec override d'une seule stratégie : **pas de bug**.
- En `runner-sim` multi-stratégies : **résultats faussés**. Aucun test ne couvre ce cas.

### Décision
**Résoudre le bag par position via `pos.meta.strategyId`** dans `WeatherExitManager.evaluate`/`evaluateSlTpTrailing`. `resolvedExitMeta` utilise `signal.strategyId`/`result.signal.strategyId`. Corrige #2 et #3 ensemble. Voir plan §2.

---

## 🟠 PROBLÈME #3 — `maxPositionsPerCityDate` non dimensionné par stratégie

### Localisation
`packages/backtest/src/adapters/weather/weather-adapter.ts:166-180` (`openCountForCityDate`) + `298-360` (`flushPendingRunnerSimSignals`)

### Code actuel
```typescript
private openCountForCityDate(ctx, city, targetDateIso): number {
  // ...
  return ctx.ledger.openPositions().filter(
    (p) =>
      (p.city ?? '').toLowerCase() === normalized &&
      p.targetDateIso === targetDateIso,  // ❌ pas de strategyId
  ).length;
}
```

### Analyse
Le live (`strategy-runner.ts:344,408`) clé par `city|date|strategyId` : deux stratégies peuvent tenir des positions sur le même couple ville+date. Le backtest clé par `city|date` seul → en `runner-sim` multi-stratégies, la 2e stratégie ne peut pas ouvrir sur la même ville+date que la 1re. Divergence de comportement, même famille que #2.

### Décision
Corrigé par la même approche que #2 (bag par position) : clé devient `city|date|strategyId`. Voir plan §2.

---

## 🔴 PROBLÈME N4 — `entryMean` absent en replay → drift exit désactivé

### Localisation
`packages/backtest/src/adapters/weather/weather-adapter.ts:536-558` (`onSignal`)

### Code actuel
```typescript
ctx.ledger.openPosition({
  // ...
  meta: {
    strategyId: data.strategyId,
    edge: data.edge ?? 0,
    // ...
    forecastProb: data.forecastProb ?? 0,
    entryBucketComparison: data.bucketComparison ?? null,
    entryBucketBounds: { low: data.bucketLow, high: data.bucketHigh, target: data.bucketTarget },
    // ❌ pas de entryMean
    ...resolvedExitMeta(ctx.configSnapshot, this.strategyId),
  },
});
```

Puis `tryExitByDecision` (`weather-adapter.ts:764`) :
```typescript
entryMean: (pos.meta.entryMean as number | undefined) ?? null,
```

### Analyse
En mode `replay`, les positions sont ouvertes via `onSignal`. Le `meta` stocke `forecastProb` mais **pas `entryMean`**. Conséquence : `pos.meta.entryMean` est `undefined` → `entryMean = null` → `exitManager.evaluate` saute le drift (`if (input.entryMean != null)` est false).

**Le drift exit est silencieusement désactivé en mode replay.** Les positions replay ne se ferment jamais pour `WEATHER_FORECAST_CHANGE`, alors qu'elles le devraient. Aucun warning n'alerte de cette désactivation.

En mode `reevaluate`/`runner-sim`, `entryMean` est bien peuplé (`weather-adapter.ts:351,499`), donc le bug est spécifique au replay.

### Décision
**Peupler `entryMean` depuis le snapshot du signal** (nécessite d'ajouter `snapshotForecastMean` au `SignalEventData` via le `data-loader`). Voir plan §3.

---

## 🟠 PROBLÈME N1 (bug fantôme) — `markPrice` stale fausse l'equity et le drawdown

### Localisation
`packages/backtest/src/engine/ledger.ts:126-133` (`updateMark`) + `weather-adapter.ts:594-596`

### Code actuel
```typescript
// weather-adapter.ts:594
if (yesPrice != null) {
  ctx.ledger.updateMark(pos.conditionId, yesPrice);
}
// ledger.ts:181
unrealized += pos.qty * pos.markPrice;  // utilisé pour equity + drawdown
```

### Analyse
`updateMark` n'est appelé que si `yesPrice != null`. Si le dernier tick d'une position a `yesPrice: null` (marché fermé, données manquantes), `markPrice` garde sa valeur précédente (ou `entryPrice` si jamais mis à jour). L'equity sample (`runner.ts:161`) et le `maxDrawdown` (`stats.ts:12`) sont calculés sur cette valeur obsolète.

**Bug fantôme** : aucun crash, aucun warning, mais les stats (equity curve, drawdown, expectancy) sont faussées pour toute position dont le dernier tick n'a pas de prix. L'utilisateur voit des courbes d'equity trompeuses.

### Décision
**Reporter le dernier prix connu** si `yesPrice=null`. Voir plan §4.

---

## 🟠 PROBLÈME N2 (bug fantôme) — `peakBid` non mis à jour → trailing stop cassé

### Localisation
`packages/backtest/src/engine/ledger.ts:126-133` (`updateMark`) + `weather-adapter.ts:594`

### Analyse
Même cause que N1. `peakBid` (utilisé pour le trailing stop, `exit-manager.ts:211`) n'est mis à jour que via `updateMark`, qui n'est appelé que si `yesPrice != null`. Si une position traverse une série de ticks sans prix puis reçoit un prix plus bas, `peakBid` reste à `entryPrice` et le trailing ne se déclenche jamais.

En live, `executableBidVwap` est toujours disponible lors de l'exécution. Divergence non documentée.

### Décision
Corrigé par la même approche que N1 (report du dernier prix). Voir plan §4.

---

## 🟠 PROBLÈME N5 (bug fantôme) — Position jamais résolue si signal avant tout tick

### Localisation
`packages/backtest/src/adapters/weather/weather-adapter.ts:517-518` (`onSignal`)

### Code actuel
```typescript
const cached = this.lastTickByCondition.get(data.conditionId);
const targetDateIso = cached?.tick.snapshotTargetDateIso ?? null;  // ❌ null si pas de tick
```

### Analyse
En mode `replay`, si un signal arrive pour une `conditionId` sans aucun `book_tick` préalable en cache :
- `targetDateIso = null` → `isReentryBlocked` saute (pas de throttle) → la position ouvre.
- La position est créée avec `targetDateIso: null` → `resolveResolutionTimeMs` retourne `null` (pas d'`endDate`, pas de `targetDateIso`) → **la position n'est jamais résolue**, reste ouverte jusqu'à la fin du backtest.
- `allPositions()` la persiste en base avec `exitAt: null`, `exitReason: null`.

**Bug fantôme** : pas de crash, mais une position « fantôme » qui fausse le total trades, l'avgHoldingMs, et l'equity final (unrealized à `markPrice = entryPrice`).

### Décision
**Résolution forcée à la fin du run** (`finish()`). Voir plan §5.

---

## 🟠 PROBLÈME N11 (bug fantôme) — `data.city = null` en replay → position non résolvable

### Localisation
`packages/backtest/src/adapters/weather/weather-adapter.ts:520,538`

### Analyse
Variante de N5. `data.city` peut être `null` si le signal n'a pas de snapshot parent avec city (`SignalEventData.city`). Dans ce cas :
- `isReentryBlocked` saute (`if (data.city && ...)`).
- La position ouvre avec `city: null`, `targetDateIso: null` (du cache, qui peut être null).
- Résolution fallback échoue → position fantôme.

### Décision
Corrigé par la même approche que N5 (résolution forcée à la fin). Voir plan §5.

---

## 🟡 PROBLÈME N3 (bug potentiel) — highest-yes non protégé vs drift/bucket (fragile)

### Localisation
`packages/backtest/src/adapters/weather/weather-adapter.ts:750-783` (`tryExitByDecision`) vs `packages/weather-algo/src/processors/weather-exit-evaluator.ts:122-126`

### Analyse
En live, le `WeatherExitEvaluator` saute explicitement drift et bucket-exit pour highest-yes :
```typescript
const isHighestYes = strategyId === WEATHER_HIGHEST_YES_STRATEGY_ID;
if (!preClose && !isHighestYes) {  // garde explicite
  // ... drift + bucket
}
```

En backtest, `tryExitByDecision` appelle `this.exitManager.evaluate(pos, ...)` **sans vérifier `isHighestYes`**. Le `exitManager.evaluate` calcule drift/bucket dès que `currentMean != null && entryMean != null`.

**Pas de bug actuel** car pour highest-yes, `meta.entryMean` est absent (`buildSignal` met `forecastMean: 0` mais pas `entryMean` dans le signal) → `entryMean = null` → drift désactivé par le guard. Mais c'est **fragile** : si un jour le meta est rempli par erreur, highest-yes se mettrait à fermer sur drift. Le live a une garde explicite, le backtest non.

### Décision
Ajouter une garde explicite `isHighestYes` dans `tryExitByDecision` (alignement live). Voir plan §6.

---

## 🟡 PROBLÈME #5 (dead code) — `proxyFallback` champ mort + warning trompeur

### Localisation
`packages/backtest/src/adapters/weather/resolution.ts:15,25,35` + `weather-adapter.ts:726-730`

### Analyse
`resolveWeatherBucket` calcule `proxyFallback: boolean` mais il n'est **jamais lu** (vérifié par grep sur `packages/backtest/src`). Le warning `resolution_proxy_forecast` (`weather-adapter.ts:727`) est émis systématiquement après résolution, même quand la résolution utilise le vrai forecast (pas un proxy). Message trompeur : il dit « résolution approximée par forecast final » alors que le forecast final **est** la source de vérité (pas un proxy).

### Décision
Supprimer `proxyFallback` + corriger le warning. Voir plan §7.

---

## 🟡 PROBLÈME N7 (dead code) — `currentEvent` jamais lu par l'adapter

### Localisation
`packages/backtest/src/engine/runner.ts:34,143,245` + `backtest-domain-adapter.ts`

### Analyse
`ctx.currentEvent` est setté par le runner (`runner.ts:245`) et déclaré dans `RunContext` (ligne 34), mais **personne ne le lit** dans `packages/backtest/src/adapters/`. Champ mort dans le contrat.

### Décision
Conserver (peut servir pour du debug/future) ou supprimer. Voir plan §7 (cleanup).

---

## 🟡 PROBLÈME N8 (dead code) — `isHighestYes` variable morte dans `evaluateExits`

### Localisation
`packages/backtest/src/adapters/weather/weather-adapter.ts:593`

### Code actuel
```typescript
const isHighestYes = pos.meta?.strategyId === WEATHER_HIGHEST_YES_STRATEGY_ID;
if (yesPrice != null) {
  ctx.ledger.updateMark(pos.conditionId, yesPrice);
}
// isHighestYes jamais utilisé dans la suite de evaluateExits
```

### Analyse
Le commentaire lignes 591-592 explique l'intention (« For highest-yes positions, we can resolve even without current yesPrice using markPrice/entryPrice fallbacks. Don't skip resolution check. ») mais le code ne fait rien avec `isHighestYes`. La résolution est bien appelée pour toutes les positions (ligne 598), indépendamment de `isHighestYes`. Variable morte.

### Décision
Supprimer la variable. Voir plan §7.

---

## 📊 Synthèse des décisions

| # | Décision | Plan § |
|---|----------|--------|
| #1 | Minuit du lendemain (`T00:00:00Z + 86_400_000`) | §1 |
| #2 + #3 | Bag par position via `pos.meta.strategyId` | §2 |
| N4 | Peupler `entryMean` depuis `snapshotForecastMean` du signal | §3 |
| N1 + N2 | Reporter le dernier prix connu si `yesPrice=null` | §4 |
| N5 + N11 | Résolution forcée à la fin du run (`finish()`) | §5 |
| N3 | Garde explicite `isHighestYes` dans `tryExitByDecision` | §6 |
| #5, N7, N8 | Cleanup dead code | §7 |

---

## 🔗 Liens

- Plan de remédiation : [`docs/plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md`](../plans/applied/2026-08-18_PLAN-fix-weather-backtest-audit.md)
- Audit précédent (highest-yes edge cases) : [`docs/audits/2026-08-15_audit-weather-algo-highest-yes-edge-cases.md`](2026-08-15_audit-weather-algo-highest-yes-edge-cases.md)
- Plan backtest précédent (appliqué 0.2.0) : [`docs/weather-algo-audits-plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md`](../weather-algo-audits-plans/2026-08-09_PLAN-PATCH-weather-algo-backtest-audit.md)
- Doc backtest : [`docs/backtest.md`](../backtest.md)