# Plan d'Implémentation — Audit Weather-Algo Highest-Yes Edge Cases

**Audit de référence** : `docs/audits/2026-08-15_audit-weather-algo-highest-yes-edge-cases.md`  
**Date** : 2026-08-15  
**Statut** : ✅ **TERMINÉ** — Toutes les phases implémentées et testées

---

## 📦 Phase 1 — Fix Bug Backtest Resolution (Priorité HAUTE) ✅ FAIT

### 1.1 Modifier `weather-adapter.ts` — `tryResolvePosition` + `evaluateExits`

**Fichier** : `packages/backtest/src/adapters/weather/weather-adapter.ts`  
**Lignes** : 584-593, 659-677

**Changements appliqués** :
```typescript
// evaluateExits: ne plus skip quand yesPrice null pour highest-yes
const isHighestYes = pos.meta?.strategyId === WEATHER_HIGHEST_YES_STRATEGY_ID;
if (yesPrice != null) {
  ctx.ledger.updateMark(pos.conditionId, yesPrice);
}
const outcome = this.tryResolvePosition(ctx, pos, tick);
// ... puis skip non-resolution exits seulement si yesPrice null

// tryResolvePosition: fallback chain
const yesPrice = tick.yesPrice ?? pos.markPrice ?? pos.entryPrice;
if (yesPrice == null) { /* warn + skip */ }
if (tick.yesPrice == null) { /* warn fallback used */ }
```

### 1.2 Tests ajoutés ✅
**Fichier** : `packages/backtest/src/adapters/weather/weather-adapter.test.ts`
- `resolves highest-yes via markPrice fallback when tick.yesPrice is null`
- `resolves highest-yes via entryPrice fallback when both tick.yesPrice and markPrice are null`

### 1.3 Validation ✅
```bash
npm run test -w @polywatch/backtest  # 33/33 tests passent
```

---

## 📦 Phase 2 — Refactor Selection Mode `single` (Priorité HAUTE) ✅ FAIT

### 2.1 Modifier `strategy-runner-selection.ts` — `applySelectionMode`

**Fichier** : `packages/weather-algo/src/strategy/strategy-runner-selection.ts`  
**Lignes** : 60-66

**Avant** : Sélection par `city` seul → retourne toutes dates de la ville gagnante
```typescript
const bestCity = normalizeWeatherCity(sorted[0]!.city);
return sorted.filter((s) => normalizeWeatherCity(s.city) === bestCity);
```

**Après** : Sélection par `(city, targetDate)` → retourne toutes stratégies du lane gagnant
```typescript
const best = sorted[0]!;
const bestCity = normalizeWeatherCity(best.city);
const bestDateIso = best.targetDate.toISOString().slice(0, 10);
return sorted.filter(
  (s) =>
    normalizeWeatherCity(s.city) === bestCity &&
    s.targetDate.toISOString().slice(0, 10) === bestDateIso,
);
```

### 2.2 Tests mis à jour + nouveaux ✅
**Fichier** : `packages/weather-algo/src/strategy/strategy-runner-selection.test.ts`
- Test existant modifié : comportement changé
- Nouveau : `applySelectionMode single picks best city+date pair, not just city`
- Nouveau : `applySelectionMode single returns all lanes for best city+date`

### 2.3 Propagation automatique ✅
**Fichier** : `packages/backtest/src/adapters/weather/runner-sim.ts` (ligne 118-123)
```typescript
export function selectRunnerSimSignals(signals, risk) {
  return applySelectionMode(dedupSignalsByCityDate(signals), risk);
}
```
→ Utilise `applySelectionMode` → bénéficie du nouveau comportement sans modification.

### 2.4 Validation ✅
```bash
npm run test -w @polywatch/weather-algo  # 81/81 tests passent
npm run test -w @polywatch/backtest      # 33/33 tests passent
```

---

## 📦 Phase 3 — Revue Guard Post-Sélection (Terminé — PAS DE CHANGEMENT)

### Analyse `strategy-runner.ts` lignes 343-366
Le guard existant est **conservé** comme defense-in-depth :

| Aspect | Pourquoi garder |
|--------|-----------------|
| Source | `openCityDates` vient de la DB (positions réellement ouvertes) |
| Scope | `applySelectionMode` filtre seulement le cycle courant |
| Risque | Sans guard, positions de cycles précédents pourraient faire dépasser `maxPositionsPerCityDate` |
| Coût | Negligeable (Map lookup O(1)) |

**Décision** : Garder le guard inchangé.

---

## 📋 Checklist de Validation Finale

| Étape | Statut | Notes |
|-------|--------|-------|
| **Phase 1.1** Fix `tryResolvePosition` fallback | ✅ | markPrice → entryPrice chain |
| **Phase 1.1** Fix `evaluateExits` skip logic | ✅ | Résolution highest-yes même sans yesPrice |
| **Phase 1.2** Tests backtest resolution | ✅ | 2 tests ajoutés, passent |
| **Phase 2.1** Refactor `applySelectionMode('single')` | ✅ | city+date au lieu de city seul |
| **Phase 2.2** Tests selection mis à jour | ✅ | 5 tests passent (2 nouveaux) |
| **Phase 2.3** Vérification `runner-sim.ts` | ✅ | Appelle applySelectionMode → auto-propagé |
| **Phase 2.4** Revue guard `strategy-runner.ts` | ✅ | Gardé comme defense-in-depth |
| **Phase 3.1** Test suite complète weather-algo | ✅ | 81/81 |
| **Phase 3.2** Test suite complète backtest | ✅ | 33/33 |

---

## ⚠️ Points d'Attention Post-Implémentation

| Risque | Statut | Mitigation |
|--------|--------|------------|
| Changement sélection `single` cassant en prod | ✅ Validé | Tests exhaustifs + behavior documenté dans audit |
| Guard `maxPositionsPerCityDate` redondant | ✅ Analysé | Gardé comme safety net (DB positions vs cycle signals) |
| Backtest `runner-sim` mode | ✅ Validé | Tests passent, utilise applySelectionMode |

---

## 📝 Fichiers Modifiés (Résumé)

| Fichier | Type | Description |
|---------|------|-------------|
| `packages/backtest/src/adapters/weather/weather-adapter.ts` | Fix | Fallback resolution + evaluateExits logic |
| `packages/backtest/src/adapters/weather/weather-adapter.test.ts` | Test | +2 tests fallback resolution |
| `packages/weather-algo/src/strategy/strategy-runner-selection.ts` | Refactor | Mode single → city+date selection |
| `packages/weather-algo/src/strategy/strategy-runner-selection.test.ts` | Test | Tests mis à jour + 2 nouveaux |

---

## 🔗 Prochaines Étapes Recommandées (Hors Plan)

1. **Mettre à jour documentation** : `docs/weather-algo.md` — documenter le nouveau comportement mode `single`
2. **Change history** : Ajouter entrée dans `change.history.md` pour les 2 fixes
3. **Feature flag optionnel** : Si déploiement progressif souhaité, ajouter `weatherAlgoSingleModeCityDate` (default `true`)

---

*Plan mis à jour le 2026-08-15 après implémentation complète et validation tests.*