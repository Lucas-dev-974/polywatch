# Audit Weather-Algo — Edge Cases `highest-yes` Strategy

**Date** : 2026-08-15  
**Auteur** : Assistant IA (analyse automatisée + validation humaine)  
**Statut** : 🔴 **Action requise** — 1 bug confirmé, 1 décision design validée  
**Commit de référence** : `d6480b7` (feat: add weather-highest-yes strategy)

---

## 📋 Résumé Exécutif

L'ajout de la stratégie `weather-highest-yes` (consensus, no forecast) introduit deux **edge cases critiques** non gérés :

| # | Problème | Gravité | Décision |
|---|----------|---------|----------|
| 1 | Backtest resolution `highest-yes` sans `yesPrice` → position fantôme | 🔴 **Bug** | Fix Option A (fallback `pos.markPrice`) |
| 2 | Mode `single` sélection par ville → `highest-yes` jamais sélectionné si forecast a un signal sur **n'importe quelle date** de la ville | 🟠 **Design** | Option B validée : sélection par `(city, targetDate)` |

---

## 🔴 PROBLÈME 1 — Backtest Resolution `highest-yes` sans `yesPrice`

### Localisation
`packages/backtest/src/adapters/weather/weather-adapter.ts` — lignes **660-667** (`tryResolvePosition`)

### Code actuel
```typescript
const isHighestYes = pos.meta?.strategyId === WEATHER_HIGHEST_YES_STRATEGY_ID;
if (isHighestYes) {
  const yesPrice = tick.yesPrice;
  if (yesPrice == null) {
    this.warnOnce(ctx, 'resolution_no_yes_price', 'Résolution highest-yes impossible sans prix YES — position laissée ouverte');
    return 'skip';  // ❌ Position NON fermée, reste ouverte indéfiniment
  }
  // ... résolution normale
}
```

### Impact
- Position `highest-yes` **jamais résolue** si données de tick finales incomplètes
- PnL figé, exposition fantôme dans le ledger backtest
- Résultats de backtest faussés (positions "zombies")

### Cause racine
Le code suppose que `tick.yesPrice` est toujours présent au tick de résolution. En pratique, les données historiques peuvent avoir des trous (dernier tick sans prix YES).

### **Fix décidé (Option A)** — Fallback sur `pos.markPrice`

```typescript
const yesPrice = tick.yesPrice ?? pos.markPrice;
if (yesPrice == null) {
  // Ultime fallback : prix d'entrée (PnL = 0)
  const fallbackPrice = pos.entryPrice;
  this.warnOnce(ctx, 'resolution_no_yes_price_fallback_entry', 'Résolution highest-yes fallback entryPrice');
  // ... résoudre avec fallbackPrice
}
```

**Rationale** : `pos.markPrice` est mis à jour à **chaque book_tick** via `ctx.ledger.updateMark(pos.conditionId, yesPrice)` (ligne 591). C'est le prix le plus récent fiable. Si absent, `pos.entryPrice` garantit une résolution (PnL neutre).

### Test à ajouter
```typescript
// weather-adapter.test.ts
it('resolves highest-yes with markPrice fallback when tick.yesPrice is null', async () => {
  // Setup position with markPrice but tick without yesPrice
  // Verify position closes with RESOLUTION reason
});
```

---

## 🟠 PROBLÈME 2 — Mode `single` : Sélection par ville empêche fallback `highest-yes`

### Localisation
`packages/weather-algo/src/strategy/strategy-runner-selection.ts` — lignes **60-65** (`applySelectionMode`)

### Code actuel
```typescript
// Single mode: pick the city with the highest-edge signal, then return all
// lane winners for that city (multiple strategies and/or dates).
const sorted = [...signals].sort((a, b) => b.edge - a.edge);
const bestCity = normalizeWeatherCity(sorted[0]!.city);
return sorted.filter((s) => normalizeWeatherCity(s.city) === bestCity);
```

### Comportement actuel
1. Tous les signaux triés par `edge` descendant
2. Ville du signal #1 = `bestCity`
3. **Tous** les signaux de `bestCity` retournés (multi-dates, multi-stratégies)

### Problème
- `highest-yes` a `edge = 0` (hardcodé, documenté comme "filet de sécurité")
- `weather-forecast` a `edge > 0` quand signal émis
- Si `weather-forecast` émet **un seul signal** sur Paris-J+1 → Paris = `bestCity`
- `highest-yes` sur Paris-J+2 **retourné** (même ville) MAIS :
  - Le guard post-sélection (`maxPositionsPerCityDate`) filtre si capacité atteinte
  - Si capacité libre → `highest-yes` **passe** (OK)
  - Mais **si `weather-forecast` a aussi un signal sur J+2** → `highest-yes` drop (edge 0 < edge forecast)

**Le vrai problème** : La sélection par **ville** (pas `city+date`) fait que `highest-yes` ne peut **jamais** être le signal #1 qui détermine `bestCity`. Il ne sert de fallback que si **aucune** stratégie forecast n'a de signal sur **toute la ville**.

### **Fix décidé (Option B)** — Sélection par `(city, targetDate)`

Nouvelle logique `applySelectionMode('single')` :
```typescript
// Single mode: pick the BEST (city, targetDate) pair by highest edge,
// then return all lane winners for that pair.
const sorted = [...signals].sort((a, b) => b.edge - a.edge);
const best = sorted[0]!;
const bestCity = normalizeWeatherCity(best.city);
const bestDateIso = best.targetDate.toISOString().slice(0, 10);
return sorted.filter((s) => 
  normalizeWeatherCity(s.city) === bestCity && 
  s.targetDate.toISOString().slice(0, 10) === bestDateIso
);
```

### Impact du changement
| Avant | Après |
|-------|-------|
| 1 ville gagnante → tous signaux ville | 1 (ville, date) gagnant → tous signaux de ce lane |
| `highest-yes` fallback seulement si ville vide | `highest-yes` fallback par **date** si forecast absent sur cette date |
| `maxPositionsPerCityDate` guard post-sélection | Guard moins sollicité (1 seul city+date émis) |

### Compatibilité
- **Mode `multi`** inchangé (garantit déjà 1 signal par stratégie)
- **Backtest** : adapter utilise `selectRunnerSimSignals` qui appelle `applySelectionMode` → impacté
- **Tests existants** : `strategy-runner-selection.test.ts` lignes 59-77 à mettre à jour

### Tests à mettre à jour / ajouter
```typescript
// strategy-runner-selection.test.ts
it('applySelectionMode single picks best city+date pair, not just city', () => {
  const signals = [
    // forecast on Paris J+1 (edge 0.2)
    signal({ city: 'Paris', targetDate: '2026-08-02', edge: 0.2, strategyId: 'weather-forecast' }),
    // highest-yes on Paris J+2 (edge 0) — should WIN for J+2 pair
    signal({ city: 'Paris', targetDate: '2026-08-03', edge: 0, strategyId: 'weather-highest-yes' }),
    // forecast on Lyon J+1 (edge 0.15) — lower edge
    signal({ city: 'Lyon', targetDate: '2026-08-02', edge: 0.15, strategyId: 'weather-forecast' }),
  ];
  
  const out = applySelectionMode(signals, { weatherAlgoSelectionMode: 'single' });
  // Should return only Paris J+2 signals (highest-yes lane winner)
  expect(out.every(s => s.targetDate.toISOString().slice(0,10) === '2026-08-03')).toBe(true);
});
```

---

## 📁 Fichiers Impactés

| Fichier | Type de changement |
|---------|-------------------|
| `packages/backtest/src/adapters/weather/weather-adapter.ts` | Fix bug resolution (lignes 660-667) |
| `packages/weather-algo/src/strategy/strategy-runner-selection.ts` | Refactor `applySelectionMode('single')` (lignes 60-65) |
| `packages/weather-algo/src/strategy/strategy-runner-selection.test.ts` | Tests mis à jour + nouveaux |
| `packages/backtest/src/adapters/weather/weather-adapter.test.ts` | Test backtest resolution fallback |
| `packages/weather-algo/src/strategy/strategy-runner.ts` | Vérifier guard post-sélection (lignes 343-353) — peut simplifier |

---

## ✅ Plan d'Action

### Phase 1 — Fix Bug Backtest (Priorité Haute)
- [ ] Modifier `tryResolvePosition` → fallback `pos.markPrice` puis `pos.entryPrice`
- [ ] Ajouter test `weather-adapter.test.ts`

### Phase 2 — Refactor Selection Single (Priorité Haute)
- [ ] Modifier `applySelectionMode` → grouper par `(city, targetDate)`
- [ ] Mettre à jour tests `strategy-runner-selection.test.ts`
- [ ] Vérifier impact sur `strategy-runner.ts` (guard lignes 343-353)
- [ ] Vérifier `selectRunnerSimSignals` dans backtest adapter

### Phase 3 — Validation
- [ ] Lancer test suite complète (`npm run test`)
- [ ] Backtest manuel sur période avec données incomplètes
- [ ] Vérifier logs : `highest-yes` émis correctement en fallback par date

---

## 🔗 Références

- Commit d'introduction : `d6480b7` — `feat(weather-algo): add weather-highest-yes strategy`
- Stratégie source : `packages/weather-algo/src/strategy/weather-highest-yes.strategy.ts` (lignes 27-33, 175)
- Selection logic : `packages/weather-algo/src/strategy/strategy-runner-selection.ts`
- Backtest adapter : `packages/backtest/src/adapters/weather/weather-adapter.ts`
- Tests existants : `strategy-runner-selection.test.ts`, `weather-highest-yes.strategy.test.ts`

---

## 📝 Notes de Décision

| Décision | Par | Date | Raison |
|----------|-----|------|--------|
| Option A (fallback markPrice) | User | 2026-08-15 | Prix le plus récent fiable, mis à jour chaque tick |
| Option B (city+date selection) | User | 2026-08-15 | Cohérent avec guard `maxPositionsPerCityDate` par city+date+strategy; highest-yes devient vrai fallback par date |

---

*Audit généré automatiquement puis validé humainement. À mettre à jour après implémentation des fixes.*