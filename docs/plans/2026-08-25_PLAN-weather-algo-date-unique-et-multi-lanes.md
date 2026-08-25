# Plan — Weather algo : date unique + multi-lanes configurable

**Date** : 2026-08-25
**Auteur** : Assistant IA
**Statut** : 🟡 **En attente d'implémentation** — vague **B** du [plan maître](./2026-08-25_PLAN-weather-algo-implementation-master.md)
**Référence audit** : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md)
**Constats couverts** : #1 (deux dates cibles), #4 (first-wins vs multi-lanes)

---

## 📋 Contexte

Deux constats de l'audit moteur live concernent le cœur du `WeatherStrategyRunner` :

- **#1 — Deux dates cibles** : le runner groupe et fetch le forecast sur la date de **question** (`dateKey`), mais le signal persiste `market.endDate` comme `targetDate`. Capacité, cache forecast, cap Redis et sélection `single` peuvent diverger sur un même marché.
- **#4 — First-wins vs multi-lanes** : `evaluateCityFollowDateGroup` s'arrête au premier signal (`return`), donc `applySelectionMode('single')` ne produit jamais « toutes les stratégies de la paire » comme son code le suggère. Le multi-stratégies sur la même paire (ville, date) dans un cycle n'est pas possible.

**Décisions produit prises** :
- #1 : la **date de question (`dateKey`)** devient l'autorité unique dans le signal.
- #4 : **hors de ce plan**. Les 4 modes de parcours des stratégies (`single` / `first-wins` / `multi` / `consensus`) sont dans [`2026-08-25_PLAN-weather-algo-modes-selection-strategie.md`](./2026-08-25_PLAN-weather-algo-modes-selection-strategie.md).

> **Correction revue 2026-08-25** : la Phase 2 ci-dessous est **annulée**. Elle mélangeait `weatherAlgoSelectionMode` (filtre **entre villes**, déjà existant) et un `multi` **entre stratégies**. Implémenter les deux dans ce fichier aurait dupliqué / contredit le plan modes.

---

## Phase 1 — Date d'autorité unique (constat #1)

### Problème

`evaluateBucketGate` (`evaluate-bucket-gate.ts:122`) et `WeatherHighestYesStrategy.buildSignal` (`weather-highest-yes.strategy.ts:161`) construisent le `targetDate` du signal depuis `market.endDate` :

```ts
const targetDate = market.endDate ? new Date(market.endDate) : new Date(nowMs);
```

Le runner, lui, groupe et fetch le forecast sur `dateKey` (issu de `parseWeatherQuestion`). Conséquence : le signal porte une `targetDate` (endDate) qui peut être différente du `dateKey` utilisé pour le regroupement, le forecast, la capacité et le cap Redis.

### Patch

1. **Injecter le `dateKey` dans le signal** plutôt que `market.endDate`. Le runner connaît déjà le `dateKey` (`evaluateCityFollowDateGroup` reçoit `dateKey` en paramètre). Le passer au `ctx` d'évaluation ou au signal après construction.

2. **Modifier `evaluateBucketGate`** pour accepter un `targetDate` explicite (depuis le `dateKey` du runner) au lieu de déduire depuis `market.endDate` :

```ts
// evaluate-bucket-gate.ts — ajouter targetDate au opts ou au ctx
export type EvaluateBucketGateOptions = {
  strategyId: string;
  minEdge: number;
  maxForecastStd: number | null;
  minForecastProbability: number | null;
  targetDate: Date; // ← NOUVEAU : dateKey du runner, pas market.endDate
};
```

3. **Modifier `WeatherHighestYesStrategy.buildSignal`** de même : accepter un `targetDate` explicite passé par le runner.

4. **Adapter `WeatherStrategy.evaluateGroup`** : le runner passe le `dateKey` résolu (`new Date(\`${dateKey}T12:00:00Z\`)`) au `ctx` ou comme paramètre d'`evaluateGroup`.

5. **Mettre à jour les tests** :
   - `evaluate-bucket-gate` : vérifier que `signal.targetDate` == `dateKey`, pas `market.endDate`.
   - `weather-highest-yes.strategy` : idem.
   - `strategy-runner.test.ts` : vérifier la cohérence dateKey → signal.targetDate → snapshot → cap Redis.

6. **`hoursToResolution`** : aujourd'hui calculé depuis `market.endDate`. Garder `market.endDate` pour ce calcul (c'est la résolution réelle du marché), mais le `targetDate` du signal reste `dateKey`. Donc découpler :
   - `signal.targetDate` = `dateKey` (identité de la position)
   - `hoursToResolution` (gate dynamique) = depuis `market.endDate` (résolution réelle)

### Fichiers touchés

- `packages/weather-algo/src/strategy/evaluate-bucket-gate.ts`
- `packages/weather-algo/src/strategy/weather-forecast.strategy.ts`
- `packages/weather-algo/src/strategy/weather-forecast-aligned.strategy.ts`
- `packages/weather-algo/src/strategy/weather-highest-yes.strategy.ts`
- `packages/weather-algo/src/strategy/strategy.ts` (`WeatherEvaluationContext.targetDate?: Date`)
- `packages/weather-algo/src/strategy/strategy-runner.ts` (passer `dateKey` → `ctx.targetDate`)
- `packages/backtest/src/adapters/weather/runner-sim.ts` + `weather-adapter.ts` : passer `targetDate` = `new Date(\`${snapshotTargetDateIso}T12:00:00Z\`)` dans le ctx (déjà la date de question enregistrée). `hoursToResolution` reste `tick.endDate`.
- Tests live + `runner-sim.test.ts` / `weather-adapter.test.ts` si le fallback `endDate` casserait un golden.

### Risques

- Le `targetDate` du snapshot `WeatherPositionForecast` change (`endDate` → `dateKey`). Les positions ouvertes existantes ont un snapshot avec `targetDate` = `endDate` ancien. L'exit evaluator fetch le forecast sur `snapshot.targetDate` : **les positions live ouvertes au moment du deploy peuvent dériver/bucket-exit contre le forecast du jour de résolution, pas du jour météo**. Acceptable (elles expirent en quelques jours) — documenter. Ne pas backfiller.
- **`resolveWeatherDate` n'est pas display-only.** Vague **B** = ce plan **+** §2.3 du plan qualité (`referenceYear` depuis `endDate`) **dans le même PR**. Inclure `resolveGroupTargetDate` (`weather-market-discovery.ts` ~441), pas seulement `resolveMarketTargetDateIso`.
- **Backtest** : `evaluateRunnerSimGroup` / `WeatherEvaluationContext` doivent recevoir `targetDate` (ISO midi UTC du `snapshotTargetDateIso`). Sans ça, `evaluateBucketGate` retombe sur `market.endDate` (souvent le 23:59 du tick) ≠ dateKey live.
- **`evaluate` per-bucket** (sans `evaluateGroup`) : les tests appellent `evaluate(market, ctx)` sans runner. Fallback : si `opts.targetDate` / `ctx.targetDate` est absent, garder `market.endDate` (tests unitaires) ; le runner live **doit** toujours passer `dateKey`.

---

## Phase 2 — ~~Multi-lanes configurable~~ ANNULÉE

**Supersédée** par [`2026-08-25_PLAN-weather-algo-modes-selection-strategie.md`](./2026-08-25_PLAN-weather-algo-modes-selection-strategie.md) (4 modes : `single` / `first-wins` / `multi` / `consensus`).

Ne pas implémenter le `return` → tableau ici : le plan modes définit *quand* collecter 1 vs N signaux. La Phase 1 (date unique) reste indépendante et prioritaire.

<details>
<summary>Ancien texte Phase 2 (ne pas implémenter)</summary>

### Problème

`evaluateCityFollowDateGroup` (`strategy-runner.ts:565-860`) parcourt les stratégies et `return result.signal` au premier signal émis. Une seule stratégie par paire (ville, date) est évaluée. Le mode `single` de `applySelectionMode` (`strategy-runner-selection.ts:60-65`) filtre pour garder « toutes les stratégies de la paire gagnante » — mais ne reçoit qu'un signal par paire, donc ce filtre est mort.

### Décision produit

Le mode `single` / `multi` devient **configurable** :
- **`single` (défaut)** : une seule position par paire (ville, date) par cycle — la première stratégie qui émet un signal (comportement actuel).
- **`multi`** : évaluer **toutes les stratégies actives** sur chaque paire, et émettre un signal par stratégie gagnante (sous réserve des gates de capacité `maxPositionsPerCityDate`).

### Patch

1. **Ne plus `return` au premier signal dans `evaluateCityFollowDateGroup`**. Collecter tous les signaux gagnants par stratégie :

```ts
// strategy-runner.ts — evaluateCityFollowDateGroup
const cityDateSignals: WeatherSignal[] = [];
for (const strategy of strategies) {
  // ... gates de capacité per-strategy ...
  let result: WeatherEvaluationResult = { kind: 'abstain', reason: 'no_signal' };
  // ... évaluation (forecast unavailable, evaluateGroup, etc.) ...
  if (result.kind === 'signal') {
    cityDateSignals.push(result.signal);
    // Ne PAS return — continuer à évaluer les autres stratégies
  }
}
return cityDateSignals; // ← tableau au lieu d'un signal unique
```

2. **Changer la signature** : `evaluateCityFollowDateGroup` retourne `WeatherSignal[]` au lieu de `WeatherSignal | null`. Adapter `evaluateCityFollowRules` en conséquence (flatten les tableaux).

3. **`applySelectionMode`** : le mode `single` ne change pas de logique (il garde la meilleure paire ville+date), mais maintenant il peut recevoir plusieurs signaux par paire (un par stratégie). Le filtre « toutes les stratégies de la paire gagnante » devient enfin alimenté. Le mode `multi` garantit un signal par stratégie émettrice puis remplit par edge descendant (déjà implémenté).

4. **Garde de capacité `maxPositionsPerCityDate`** : déjà présente dans la boucle `evaluateCityFollowDateGroup` (ligne 720) et dans la boucle d'envoi (`strategy-runner.ts:340-360`). Conserver. En mode `multi`, plusieurs stratégies peuvent vouloir ouvrir sur la même paire — la garde `maxPositionsPerCityDate` (par stratégie) limite naturellement.

5. **Tests** :
   - `strategy-runner.test.ts` : cas multi-stratégies sur la même paire (forecast + highest-yes tous deux gagnants) → 2 signaux émis en mode `multi`, 1 seul en mode `single`.
   - `strategy-runner-selection.test.ts` : `applySelectionMode('single')` avec 2 signaux sur la même paire (différentes stratégies) → les 2 retournés (même paire gagnante).

### Fichiers touchés

- `packages/weather-algo/src/strategy/strategy-runner.ts` (signature `evaluateCityFollowDateGroup`, boucle d'évaluation, `evaluateCityFollowRules`)
- `packages/weather-algo/src/strategy/strategy-runner-selection.ts` (vérifier que `single` gère bien plusieurs signaux par paire)
- Tests : `strategy-runner.test.ts`, `strategy-runner-selection.test.ts`

### Risques

- **PnL multi-positions sur la même paire** : voir plan modes, mode `multi`.

</details>

---

## Checklist de validation

### Phase 1 (date unique)
- [ ] `signal.targetDate` == `dateKey` (midi UTC) dans les tests de gate
- [ ] `hoursToResolution` reste calculé depuis `market.endDate` / `tick.endDate`
- [ ] `ctx.targetDate` fourni par le runner live **et** `evaluateRunnerSimGroup`
- [ ] `resolveWeatherDate(..., referenceYear)` livré dans le même PR (plan qualité §2.3)
- [ ] Exit evaluator OK avec snapshots legacy (`targetDate` = ancien endDate)
- [ ] Cap Redis ville+date cohérent avec le `dateKey` du signal

### Phase 2
- [x] **Annulée** — voir plan modes de sélection

---

## Références

- Audit : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md) §4 #1, #4
- Canvas : [`weather-algo-engine-audit.canvas.tsx`](../../C:/Users/lcsystem/.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-engine-audit.canvas.tsx)