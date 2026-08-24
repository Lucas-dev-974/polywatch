# PLAN — Corriger le sizing `fixed_shares` dans le backtest météo (fill-engine)

> **Date :** 2026-08-24
> **Réf. audit :** `docs/audits/2026-08-24_audit-run40-fixed-shares-sizing.md` — section 8, action 1 (priorité haute)
> **Run impacté :** #40 (et tout run où la stratégie utilise `sizingMode: 'fixed_shares'`)
> **Statut :** ✅ **IMPLÉMENTÉ** (2026-08-24) — voir §8 "Implémentation réelle"

---

## 1. Problème

Le backtest météo taille **toujours** en USDC fixe (`qty = entryUsdc / price`), alors que la stratégie `weather-highest-yes` est configurée en `sizingMode: 'fixed_shares'` avec `fixedShareCount: 5`. Sur un prix YES quasi nul (ex. 0.0005), le backtest achète 20 000 tokens (10 USDC) au lieu de 5 tokens (0.0025 USDC) → perte artificielle de ~10 USDC par position (82 USDC cumulés sur la run #40).

Le live respecte bien `fixed_shares` (`packages/core/src/sizing/compute.ts:125-135` `computeFixedSharesQuantity`), appelé par `weather-entry-pipeline.ts:353`. Le backtest ne le réplique pas.

## 2. Cause racine

- `packages/backtest/src/engine/fill-engine.ts:35` : `qty = cappedUsdc / price` — sizing USDC durcodé, ignore `sizingMode`/`fixedShareCount`.
- `packages/backtest/src/adapters/weather/weather-adapter.ts` `flushPendingRunnerSimSignals` (ligne 364) ET `onSignal` (ligne 503) : les **deux** call-sites appellent `simulateWeatherEntryFill` sans transmettre le bag de sizing.
- `packages/backtest/src/adapters/weather/weather-adapter.ts` `canEnter` (ligne 182-210) : calcule aussi `qty = cappedUsdc / entryPrice` (ligne 195) pour estimer le coût et l'exposition. En `fixed_shares`, le coût réel est `fixedShareCount × price` (ex. 5 × 0.0005 = 0.0025 USDC), pas `entryUsdc` (10 USDC). Sans correction, `canEnter` est trop conservateur (bloque des entrées qui devraient passer) et l'exposition est gonflée (10 USDC au lieu de 0.0025).

**Points clés :**
- Au call-site `flushPendingRunnerSimSignals`, `signalBag = getStrategyParams(risk, signal.strategyId)` contient déjà `sizingMode` et `fixedShareCount` (ligne 352).
- Au call-site `onSignal`, `getStrategyParams(risk, data.strategyId)` est déjà appelé (ligne 498 et 508) — le bag est disponible.
- `canEnter` reçoit déjà `strategyId` et résout le bag (ligne 189-191).
- Le correctif est donc **localisé** aux 3 fonctions, sans changement de contrat.

## 3. Approche

Répliquer la logique de `computeFixedSharesQuantity` (sizing live) dans `simulateWeatherEntryFill` du backtest, en ajoutant `sizingMode`/`fixedShareCount` à `FillInput`, et en les passant depuis l'appelant.

### 3.1 `packages/backtest/src/engine/fill-engine.ts`

Étendre `FillInput` et `simulateWeatherEntryFill` :

```ts
export interface FillInput {
  conditionId: string;
  yesPrice: number;
  entryUsdc: number;
  slippageBps: number;
  maxPositionSizeUsdc?: number;
  /** Sizing mode from the emitting strategy's bag (defaults to fixed_usdc). */
  sizingMode?: 'fixed_usdc' | 'fixed_shares';
  /** Fixed share count when sizingMode === 'fixed_shares'. */
  fixedShareCount?: number;
}

export function simulateWeatherEntryFill(input: FillInput): FillResult {
  const price = Math.min(1, input.yesPrice * (1 + input.slippageBps / 10_000));
  if (input.sizingMode === 'fixed_shares') {
    // Miroir de computeFixedSharesQuantity (core/src/sizing/compute.ts:125).
    const maxSharesByBudget =
      Math.min(input.maxPositionSizeUsdc ?? Number.POSITIVE_INFINITY, input.entryUsdc) / price;
    const targetShares = Math.floor(Math.min(input.fixedShareCount ?? 0, maxSharesByBudget));
    const qty = targetShares > 0 ? targetShares : 0;
    const fees = computeTakerFee(qty, price, BACKTEST_PLATFORM_FEE);
    return { conditionId: input.conditionId, qty, entryPrice: price, fees };
  }
  const cappedUsdc = Math.min(
    input.entryUsdc,
    input.maxPositionSizeUsdc ?? Number.POSITIVE_INFINITY,
  );
  const qty = cappedUsdc / price;
  const fees = computeTakerFee(qty, price, BACKTEST_PLATFORM_FEE);
  return { conditionId: input.conditionId, qty, entryPrice: price, fees };
}
```

> **Note cap budget** : `computeFixedSharesQuantity` live utilise `maxSpendUsdc = min(maxPositionSizeUsdc, userBalance)`. En backtest, `entryUsdc` du run joue le rôle de budget d'entrée ; le cap `min(maxPositionSizeUsdc, entryUsdc)/price` est la transposition fidèle. Comportement attendu : pour `fixedShareCount=5`, prix 0.0005, entryUsdc=10, maxPositionSizeUsdc=200 → `targetShares = floor(min(5, 10/0.0005)) = 5`.

### 3.2 `packages/backtest/src/adapters/weather/weather-adapter.ts`

**3 corrections nécessaires :**

**a) `canEnter` (ligne 182-210)** : estimer le coût selon le mode de sizing réel. En `fixed_shares`, `cost = fixedShareCount × price + fees`, pas `entryUsdc + fees` :

```ts
private canEnter(
  ctx: RunContext,
  entryUsdc: number,
  yesPrice: number,
  strategyId: string | null,
): boolean {
  this.emitStaticFidelityWarnings(ctx);
  const bag = strategyId
    ? getStrategyParams(ctx.configSnapshot, strategyId)
    : this.bag;
  const slippage = ctx.params.slippageBps;
  const entryPrice = yesPrice * (1 + slippage / 10_000);

  // Sizing selon le mode du bag (parité avec simulateWeatherEntryFill).
  let qty: number;
  let costBasisUsdc: number;
  if (bag.sizingMode === 'fixed_shares') {
    const maxSharesByBudget = Math.min(bag.maxPositionSizeUsdc ?? Infinity, entryUsdc) / entryPrice;
    qty = Math.floor(Math.min(bag.fixedShareCount ?? 0, maxSharesByBudget));
    costBasisUsdc = qty * entryPrice;
  } else {
    const cappedUsdc = Math.min(entryUsdc, bag.maxPositionSizeUsdc ?? Number.POSITIVE_INFINITY);
    qty = cappedUsdc / entryPrice;
    costBasisUsdc = cappedUsdc;
  }
  const estFees = computeTakerFee(qty, entryPrice, BACKTEST_PLATFORM_FEE);
  const cost = costBasisUsdc + estFees;

  if (ctx.ledger.cash < cost) return false;

  const maxExposure = bag.maxExposureUsdc;
  if (maxExposure != null && ctx.ledger.openExposure(strategyId) + costBasisUsdc > maxExposure) return false;

  if (this.isDailyLossBreached(ctx, strategyId)) return false;
  return true;
}
```

**b) `flushPendingRunnerSimSignals` (ligne 364)** : passer le bag de sizing :

```ts
const fill = simulateWeatherEntryFill({
  conditionId: signal.conditionId,
  yesPrice,
  entryUsdc: ctx.params.entryUsdc,
  slippageBps: ctx.params.slippageBps,
  maxPositionSizeUsdc: signalBag.maxPositionSizeUsdc,
  sizingMode: signalBag.sizingMode,
  fixedShareCount: signalBag.fixedShareCount,
});
```

**c) `onSignal` (ligne 503)** : passer le bag de sizing (résoudre `dataBag` une fois) :

```ts
const dataBag = getStrategyParams(risk, data.strategyId);
const fill = simulateWeatherEntryFill({
  conditionId: data.conditionId,
  yesPrice: data.yesPrice,
  entryUsdc: ctx.params.entryUsdc,
  slippageBps: ctx.params.slippageBps,
  maxPositionSizeUsdc: dataBag.maxPositionSizeUsdc,
  sizingMode: dataBag.sizingMode,
  fixedShareCount: dataBag.fixedShareCount,
});
```

## 4. Tests

- **Nouveau test** `packages/backtest/src/engine/fill-engine.test.ts` :
  - `fixed_shares` avec `fixedShareCount=5`, prix 0.0005 → `qty = 5`, `fees` cohérentes (courbe 2-3 bps).
  - `fixed_shares` avec budget trop serré (ex. `entryUsdc=10`, prix 0.5, `maxPositionSizeUsdc=1`) → `qty = floor(1/0.5) = 2`.
  - `fixed_usdc` (défaut) inchangé : `qty = entryUsdc/price`.
  - `fixed_shares` avec `fixedShareCount` absent/0 → `qty = 0` (aucune entrée) ou gérer comme abstention.
- **Régression** : les 73 tests backtest existants restent verts (le défaut `fixed_usdc` préserve le comportement actuel des autres stratégies).

## 5. Vérification

1. `npm run test -w @polywatch/backtest` → vert.
2. `npm run build` → tous les packages compilent.
3. Relancer la run #40 : les 8 positions à prix quasi nul doivent avoir `qty = 5` et `pnl ≈ -0.0025` chacune (au lieu de `qty ≈ 19900`, `pnl ≈ -10.3`).

## 6. Risques

- **Changement de comportement pour toute stratégie `fixed_shares`** en backtest : les runs passés (tous size en USDC) ne sont **pas** comparables aux runs futurs. Noter que `engine_version` ne change **pas** (le fix ne touche pas la sémantique de replay, mais il faudra le documenter dans `docs/backtest.md`).
- **Parité live** : vérifier que le cap `min(maxPositionSizeUsdc, entryUsdc)/price` reproduit bien `maxSpendUsdc(userBalance)` du live quand `entryUsdc` du run diffère du cash réel. Si divergence, documenter en warning.

## 7. Fichiers

| Fichier | Action |
|---------|--------|
| `packages/backtest/src/engine/fill-engine.ts` | Modifier (`FillInput` + branche `fixed_shares`) |
| `packages/backtest/src/adapters/weather/weather-adapter.ts` | Modifier (passer `sizingMode`/`fixedShareCount`) |
| `packages/backtest/src/engine/fill-engine.test.ts` | Ajouter tests `fixed_shares` |
| `docs/backtest.md` | Documenter le sizing par stratégie + note de non-comparabilité |

---

## 8. Implémentation réelle (2026-08-24)

### Écarts entre l'approche planifiée et le code appliqué

| Point | Planifié | Réel |
|-------|----------|------|
| `fill-engine.ts` | `qty = min(fixedShareCount, budget/price)` | ✅ identique + **garde `price <= 0`** (retourne `qty: 0`) et **garde `qty <= 0`** (retourne `qty: 0`) |
| `canEnter` | coût selon mode | ✅ identique + **garde `entryPrice <= 0`** et **garde `qty <= 0`** (retourne `false`) |
| `flushPendingRunnerSimSignals` | passer le bag | ✅ identique |
| `onSignal` | passer le bag | ✅ identique (résout `dataBag` une fois) |
| Warning `risk_sizing_mode_ignored` | (plan 2) | ✅ émis dans `canEnter` (point commun des 2 chemins) |

### Bugs fantômes trouvés pendant l'implémentation (corrigés)

1. **`qty = 0` en `fixed_shares`** : le fill retournait `qty: 0` et `canEnter` ouvrait une position vide. Corrigé : `canEnter` retourne `false` si `qty <= 0`, le fill retourne `qty: 0` (l'appelant skip).
2. **`price = 0`** : division par 0 → `Infinity` → position ouverte à coût 0. Corrigé : garde `price <= 0` dans le fill et `entryPrice <= 0` dans `canEnter`.

### Fichiers réellement modifiés

- `packages/backtest/src/engine/fill-engine.ts`
- `packages/backtest/src/adapters/weather/weather-adapter.ts`
- `packages/backtest/src/engine/fill-engine.test.ts` (4 nouveaux tests)

### Vérification

- `npm run test -w @polywatch/backtest` → **77/77** (73 + 4 nouveaux)
- `npm run build` → ✅
- `npm run lint` → ✅ aucune erreur dans les fichiers modifiés
