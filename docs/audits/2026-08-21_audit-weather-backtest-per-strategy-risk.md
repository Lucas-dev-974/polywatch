# Audit Weather Backtest — Garde-fous risk per-strategy

**Date** : 2026-08-21
**Auteur** : Assistant IA (audit en 3 passes : détection, vérification, implémentation)
**Statut** : 🟢 **Résolu** — 1 finding confirmé (F1), 1 finding nuancé (F6) reverté ; correctifs implémentés et testés
**Périmètre** : `packages/backtest/src/engine/ledger.ts`, `packages/backtest/src/adapters/weather/weather-adapter.ts`
**Engine version** : `0.4.0` → **`0.5.0`**

> **Note de périmètre** : cet audit fait suite à l'audit moteur 0.4.0
> ([`2026-08-19_audit-weather-backtest-moteur.md`](./2026-08-19_audit-weather-backtest-moteur.md)).
> Il se concentre sur la **résolution des garde-fous risk par stratégie** dans le
> backtest, en comparaison avec le système live (`policy.ts`, `reservation.service.ts`).

---

## ✅ Résolution (plan appliqué — `engineVersion` 0.5.0)

| Finding | Gravité | Action appliquée |
|---------|---------|------------------|
| F1 | 🔴 Critique | **Corrigé** — `canEnter`, `isDailyLossBreached`, `maybeForceCloseAll`, `flushPendingRunnerSimSignals`, `onSignal`, `onBookTick` résolvent maintenant les paramètres risk via `getStrategyParams(cfgSnapshot, strategyId)` au lieu de `this.bag` global |
| F2 | — | **Faux positif** — `tryResolveByPrice` utilise correctement `markPrice` vs `entryPrice` (distinction `fallbackSource` à la ligne 639) |
| F6 | 🟡 Nuancé | **Reverté** — Le guard `tick.yesPrice != null` a été ajouté en défense en profondeur puis retiré : les tests L562-689 de `weather-adapter.test.ts` valident explicitement la résolution par fallback `markPrice`/`entryPrice` quand `tick.yesPrice` est null. Ce comportement est un feature intentionnel, pas un bug. Le scénario de "résolution parasite" est pratiquement impossible (ordre d'exécution `updateMark` → `tryResolveByPrice` dans le même tick). |

---

## 📋 Résumé exécutif

L'audit a identifié que le backtest résolvait les garde-fous risk (`maxExposureUsdc`,
`maxDailyLossUsdc`, `killSwitchAction`, `maxPositionSizeUsdc`) via un **bag global**
(`this.bag`) au lieu du bag de la stratégie propriétaire de chaque position. En mode
`runner-sim` multi-stratégies, cela produisait une **divergence avec le live** :
- Une stratégie A avec `maxExposureUsdc = 15` ne bloquait pas l'entrée si la stratégie B
  avait déjà de l'exposition (le bag global pouvait avoir un `maxExposureUsdc` différent).
- Le kill-switch `force_close_all` fermait **toutes** les positions du ledger, pas
  seulement celles de la stratégie déclenchée.
- `maxDailyLossUsdc` était évalué sur le PnL réalisé **total**, pas par stratégie.

Ces divergences sont corrigées dans la version 0.5.0.

---

## 🔴 F1 — Garde-fous risk non résolus par stratégie

**Gravité** : 🔴 Critique (divergence live ↔ backtest sur les garde-fous risk)
**Localisation** : `weather-adapter.ts` — `canEnter`, `isDailyLossBreached`, `maybeForceCloseAll`, `flushPendingRunnerSimSignals`, `onSignal`, `onBookTick`

### Problème

Le live résout les paramètres risk par stratégie :
- `policy.ts` : `getWeatherMaxExposureUsdc(cfg, mode, strategyId)`, `getWeatherMaxDailyLossUsdc(cfg, mode, strategyId)`, `getWeatherKillSwitchAction(cfg, mode, strategyId)`
- `reservation.service.ts` : `countActivePositions` filtre par `strategyId`

Le backtest utilisait `this.bag` (le bag de `this.strategyId`) pour **toutes** les
positions, même en `runner-sim` où les positions peuvent appartenir à différentes
stratégies. Conséquences :

1. **`maxExposureUsdc`** : `canEnter` vérifiait `openExposure()` (total) contre
   `this.bag.maxExposureUsdc` — pas l'exposition de la stratégie émettrice.
2. **`maxDailyLossUsdc`** : `isDailyLossBreached` vérifiait `dailyRealizedPnl(at)`
   (total) contre `this.bag.maxDailyLossUsdc` — pas le PnL de la stratégie.
3. **`killSwitchAction`** : `maybeForceCloseAll` fermait toutes les positions si
   `this.bag.killSwitchAction === 'force_close_all'` — pas par stratégie.
4. **`maxPositionSizeUsdc`** : `flushPendingRunnerSimSignals` utilisait
   `this.bag.maxPositionSizeUsdc` — pas le bag du signal.
5. **`maxPositionsPerCityDate`** : `onSignal` utilisait `this.bag.maxPositionsPerCityDate`
   — pas le bag de `data.strategyId`.

### Correctif appliqué

#### `ledger.ts`

`openExposure(strategyId?)` et `dailyRealizedPnl(at, strategyId?)` acceptent un
paramètre optionnel `strategyId` pour filtrer par stratégie :

```typescript
openExposure(strategyId?: string | null): number {
  let total = 0;
  for (const pos of this.open.values()) {
    if (strategyId !== undefined) {
      const posStrategy = (pos.meta?.strategyId as string | null | undefined) ?? null;
      if (posStrategy !== strategyId) continue;
    }
    total += pos.qty * pos.entryPrice;
  }
  return total;
}
```

#### `weather-adapter.ts`

- `isDailyLossBreached(ctx, strategyId)` : résout le bag via
  `getStrategyParams(ctx.configSnapshot, strategyId)` et filtre
  `dailyRealizedPnl(ctx.clock.now(), strategyId)`.
- `canEnter(ctx, entryUsdc, yesPrice, strategyId)` : résout le bag via
  `getStrategyParams(ctx.configSnapshot, strategyId)`, filtre
  `openExposure(strategyId)`, appelle `isDailyLossBreached(ctx, strategyId)`.
- `maybeForceCloseAll(ctx)` : groupe les positions par `strategyId`, évalue chaque
  kill-switch avec son propre bag, ne ferme que les positions des stratégies
  déclenchées (`firedStrategies`).
- `flushPendingRunnerSimSignals` : utilise `signalBag.maxPositionSizeUsdc` et
  `canEnter(ctx, entryUsdc, yesPrice, signal.strategyId)`.
- `onSignal` : utilise `getStrategyParams(risk, data.strategyId).maxPositionsPerCityDate`
  et `getStrategyParams(risk, data.strategyId).maxPositionSizeUsdc`.
- `onBookTick` : passe `this.strategyId` à `canEnter` (mode strategy, bag = `this.bag`).

### Tests

4 tests ajoutés dans `weather-adapter.test.ts` :
1. `ledger.openExposure` filtre par `strategyId` (unit test)
2. `ledger.dailyRealizedPnl` filtre par `strategyId` (unit test)
3. `maxExposureUsdc` par stratégie bloque 2e entrée (intégration)
4. `maxExposureUsdc` généreux autorise multiple entrées (intégration)

---

## 🟡 F6 — `tryResolveByPrice` fallback markPrice/entryPrice (défense en profondeur)

**Gravité** : 🟡 Nuancé
**Localisation** : `weather-adapter.ts` — `tryResolveByPrice`

### Analyse

Le guard `tick.yesPrice != null` a été ajouté en défense en profondeur pour empêcher
une "résolution parasite" via un `markPrice` stale. Cependant :

1. Les tests L562-689 de `weather-adapter.test.ts` valident explicitement la
   résolution par fallback `markPrice`/`entryPrice` quand `tick.yesPrice` est null.
2. Ce comportement est un **feature intentionnel** (chaîne de fallback documentée).
3. Le scénario de "résolution parasite" est pratiquement impossible : `evaluateExits`
   appelle `updateMark(conditionId, yesPrice)` **avant** `tryResolveByPrice` dans le
   même tick, donc le `markPrice` est toujours frais si un tick précédent avait un
   prix valide.

### Décision

Le guard a été **reverté** pour préserver le comportement testé. Le block `yesPrice == null`
mort introduit par le guard a été nettoyé.

---

## 🔍 F2 — `tryResolveByPrice` fallbackSource (faux positif)

**Gravité** : — (faux positif)
**Localisation** : `weather-adapter.ts` — `tryResolveByPrice` ligne 639

L'audit initial claimait un bug dans la distinction `markPrice` vs `entryPrice` pour
`fallbackSource`. Vérification : le code (`pos.markPrice !== pos.entryPrice ? 'markPrice' : 'entryPrice'`)
est **correct** — il compare les valeurs pour déterminer la source réelle du fallback.
Faux positif confirmé.

---

## 📊 Vérification finale

| Critère | Résultat |
|---------|----------|
| Typecheck (`tsc --noEmit`) | ✅ Exit 0 |
| Linter (4 fichiers modifiés) | ✅ 0 erreurs |
| Tests backtest (6 fichiers) | ✅ 45/45 passés |
| Dead code résiduel | ✅ Aucun |
| Imports inutilisés | ✅ Aucun (`WeatherStrategyParamsBag`, `LedgerPosition` utilisés) |

### Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `packages/backtest/src/engine-version.ts` | `0.4.0` → `0.5.0` |
| `packages/backtest/src/engine/ledger.ts` | `openExposure(strategyId?)`, `dailyRealizedPnl(at, strategyId?)` |
| `packages/backtest/src/adapters/weather/weather-adapter.ts` | `canEnter`, `isDailyLossBreached`, `maybeForceCloseAll`, `flushPendingRunnerSimSignals`, `onSignal`, `onBookTick` — résolution per-strategy |
| `packages/backtest/src/adapters/weather/weather-adapter.test.ts` | +4 tests per-strategy |

### Documentation mise à jour

| Fichier | Changement |
|---------|------------|
| `docs/backtest.md` | engineVersion 0.5.0, garde-fous per-strategy, KILL_SWITCH per-strategy, tests 45 |
| `docs/code/09-backtest.md` | engineVersion 0.5.0, ledger `strategyId` filter, adapter per-strategy, KILL_SWITCH, tests 45 |
| `docs/weather-algo.md` | Référence `engineVersion` ≥ 0.5.0 |
| `docs/modele-donnees.md` | Exemple `engine_version` : 0.5.0 |
| `docs/api.md` | `BACKTEST_ENGINE_VERSION` : 0.5.0+ |
| `change.history.md` | Entrée 2026-08-21 |