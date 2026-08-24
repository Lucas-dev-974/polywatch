# Audit Run #40 — Backtest Météo : bug de sizing `fixed_shares` ignoré

> **Date :** 2026-08-24
> **Run audité :** `backtest_runs.id = 40`
> **Statut du run :** `completed`, engine `0.6.0`
> **Résultat de l'audit :** 1 bug majeur de fidélité confirmé (sizing `fixed_shares` ignoré par le moteur), 1 point de config à corriger (`minYesPrice`), inférence initiale à nuancer.

---

## 1. Contexte du run

| Champ | Valeur |
|-------|--------|
| id | 40 |
| status | `completed` (progress 100%) |
| engine_version | `0.6.0` (comparable) |
| domain / mode | `weather` / `reevaluate` |
| backtestExecutionMode | `runner-sim` |
| strategyId | `weather-highest-yes` |
| capital | 1000 USDC |
| entryUsdc | 10 USDC |
| slippageBps | 50 |
| maxConcurrentPositions | 10 |
| Plage | 2026-08-19 02:00 → 2026-08-24 01:55 |
| Durée du run | 27 s (05:19:32 → 05:19:59) |
| config_fingerprint | `cfg:1tkdq8` |

### Résultats globaux

- **PnL total : −93.95 USDC (−9.39%)** — capital final 906.05
- Win rate 61.25 % (49/80)
- **Profit factor 0.63** (< 1 = run perdant)
- avgWin +3.22 vs **avgLoss −8.99** (2.8× plus gros)
- maxDrawdown 14.4 %
- **Cohérence mathématique : −182.55 (RESOLUTION) + 92.83 (TRAILING) + −4.23 (GHOST) = −93.95** ✅

### Répartition des sorties

| Sortie | N | PnL total | Remarque |
|--------|---|-----------|----------|
| `RESOLUTION` | 39 | **−182.55** | Source de la perte |
| `TRAILING` | 32 | +92.83 | Source du gain |
| `BACKTEST_INCOMPLETE_DATA` | 9 | −4.23 | Positions "fantômes" (résolution forcée en fin de run) |

---

## 2. 🚨 Anomalie majeure : sizing catastrophique sur prix quasi nuls

**8 positions ont été saisies avec un prix YES presque nul (0.0005 à 0.015)**, produisant des **quantités astronomiques** (663 à 19 900 tokens) et des pertes fixes d'environ **−10.3 USDC chacune** (~ **82 USDC cumulés**).

| Ville | Prix entrée | Quantité | Bucket | PnL |
|-------|-------------|----------|--------|-----|
| Austin | 0.0005 | 19 900 | between 38.9–39.4 | −10.30 |
| Cape Town | 0.0005 | 19 900 | exact 18 | −10.30 |
| Cape Town | 0.0005 | 19 900 | exact 18 | −10.30 |
| Amsterdam | 0.0005 | 19 900 | exact 19 | −10.30 |
| Chongqing | 0.006 | 1 658 | exact 31 | −10.30 |
| Buenos Aires | 0.0065 | 1 531 | exact 22 | −10.30 |
| Austin | 0.010 | 995 | between 40–40.6 | −10.30 |
| Denver | 0.015 | 663 | between 28.9–29.4 | −10.30 |

Toutes les entrées `entry_reason = signal` (mode reevaluate). Les buckets concernés sont `exact` / `between` — des sous-marchés légitimement proches de 0 (ex. "température exactement 18°C"), **pas** des `or_above`/`or_below` (dont le prix YES est mécaniquement gonflé).

---

## 3. Cause racine confirmée (bug de sizing)

### En live : `fixed_shares` respecté

`packages/core/src/sizing/compute.ts:125-135` — `computeFixedSharesQuantity()` :

```ts
function computeFixedSharesQuantity(input: SizingInput): number | null {
  let targetShares = applySignalMultiplier(base, input.signalMultiplier);
  const maxSharesByBudget = maxSpendUsdc(input) / input.executableAskVwap;
  targetShares = Math.min(targetShares, maxSharesByBudget);
  targetShares = Math.floor(targetShares);
  return targetShares >= MIN_ORDER_SHARES ? targetShares : null;
}
```

Le bag config `weather-highest-yes` spécifie :
```json
"sizingMode": "fixed_shares",
"fixedShareCount": 5,
"maxYesPrice": 0.61,
"minYesPrice": null,
"allowedComparisons": null
```

Avec `fixedShareCount=5` et `askVwap=0.0005` → `targetShares = min(5, 10/0.0005) = 5` → **5 tokens à 0.0005 = 0.0025 USDC**. Perte potentielle : ~0.0025 USDC (négligeable).

Le pipeline live (`weather-entry-pipeline.ts:288-294`) passe bien `sizingMode` + `fixedShareCount` à `computeEntryTargetQuantity`.

### En backtest : `fixed_shares` ignoré

`packages/backtest/src/engine/fill-engine.ts:29-38` — `simulateWeatherEntryFill()` :

```ts
export function simulateWeatherEntryFill(input: FillInput): FillResult {
  const price = Math.min(1, input.yesPrice * (1 + input.slippageBps / 10_000));
  const cappedUsdc = Math.min(input.entryUsdc, input.maxPositionSizeUsdc ?? Infinity);
  const qty = cappedUsdc / price;   // ← TOUJOURS sizing USDC
  const fees = computeTakerFee(qty, price, BACKTEST_PLATFORM_FEE);
  return { conditionId: input.conditionId, qty, entryPrice: price, fees };
}
```

Avec `entryUsdc=10` et `price=0.0005` → `qty = 10/0.0005 = 20 000` → **20 000 tokens à 0.0005 = 10 USDC**. Perte potentielle : ~10 USDC.

**Le backtest ignore totalement `sizingMode` et `fixedShareCount`** du bag de la stratégie émettrice et taille systématiquement en USDC fixe (`10 / price`). Appelé depuis `flushPendingRunnerSimSignals` (weather-adapter.ts) avec `entryUsdc: ctx.params.entryUsdc`.

**Verdict : bug de fidélité majeur.** Le backtest gonfle artificiellement la perte des entrées sur les tokens pas chers (×4 000 en quantité pour un prix ×0.0005).

---

## 4. Bug lié : `minYesPrice` non configuré

Le bag `weather-highest-yes` a `minYesPrice: null` et `allowedComparisons: null`. La stratégie `evaluateGroup` (`weather-highest-yes.strategy.ts:103-108`) ne filtre donc **pas** les prix très bas : elle choisit "le bucket au prix YES le plus élevé" même si le meilleur ne vaut que 0.0005. Combiné au bug de sizing, chaque ville dont les sous-marchés sont tous quasi nuls déclenche une entrée ruineuse.

`maxYesPrice: 0.61` est bien présent (borne haute), mais **aucune borne basse** ne protège. Un `minYesPrice` (ex. 0.5, cohérent avec `maxYesPrice: 0.61`) bloquerait ces entrées.

---

## 5. Points sains

- **TRAILING fonctionne** : 32 trades, +92.83, avg +2.90 — le trailing stop sécurise bien les gains.
- **Déterminisme** : run rejouable (engine 0.6.0 + config_fingerprint `cfg:1tkdq8`).
- **Warnings documentés** : les 8 warnings de fidélité sont tous explicités et cohérents.
- **`market_lifecycle_filtered` absent** : pas de rejet massif de marchés (filtre de cycle de vie sain).

### Warnings de fidélité émis (run #40)

| Code | Signification | Gravité |
|------|---------------|---------|
| `risk_sl_confirmation_ignored` | SL au 1er tick (pas de confirmation live) | Documenté |
| `risk_sizing_simplified_fixed_usdc` | **Sizing fixe entryUsdc (pas de signal-score sizing live)** | ⚠️ masque le bug |
| `risk_min_time_to_close_ignored` | minTimeToClose non appliqué | Documenté |
| `fill_no_book_depth` | Fills non plafonnés par liquidité | Documenté |
| `multi_position_stale_mark` | 5 positions évaluées avec tick périmé (max 303 s > pollMs) | Limite connue (lag-1) |
| `resolution_by_price` | Résolution par prix YES (≥0.99 / ≤0.01), pas de température | Documenté |
| `fill_price_clamped` | 1 entrée clampée à 1.0 (slippage 50 bps sur 0.9995) | Mineur |
| `ghost_positions_forced_resolution` | 9 positions ouvertes en fin de run — résolution forcée | Attendu (plage `to` clôt trop tôt) |

> **Note** : le warning `risk_sizing_simplified_fixed_usdc` documente bien "sizing fixe entryUsdc", mais ne mentionne **pas** que le mode `fixed_shares` configuré par stratégie est carrément ignoré — l'implémentation va au-delà de la simplification annoncée.

---

## 6. Alerts secondaires

- **`ghost_positions_forced_resolution` = 9** : positions encore ouvertes en fin de plage, résolues forcées au dernier mark. Warning prévu, mais le paramètre `to` peut clôturer trop tôt par rapport à la résolution réelle des marchés.
- **`fill_price_clamped`** : 1 entrée clampée à 1.0 (slippage 50 bps sur un prix à 0.9995) — mineur.
- **`multi_position_stale_mark`** : 5 positions évaluées avec un tick périmé (max 303 s > pollMs 1800 s) — marque-price lag-1, limite documentée.

---

## 7. Correction de l'inférence initiale

La phrase initiale *"sans ce bug, la run aurait probablement été proche de l'équilibre voire positive"* est une **inférence non vérifiée**. Formulation corrigée :

> Sans le bug de sizing, les 8 positions à prix quasi nul n'auraient coûté que ~0.02 USDC (5 tokens × 0.0005) au lieu de ~82 USDC, soit une différence de ~82 USDC sur le PnL final. Les autres 72 positions auraient aussi eu des tailles différentes (5 tokens au lieu de ~19 tokens), donc le PnL des 72 autres positions serait modifié. **La cause principale de la perte (−93.95 USDC) est le sizing incorrect sur les 8 entrées à prix quasi nul.**

---

## 8. Actions recommandées

| # | Priorité | Action |
|---|----------|--------|
| 1 | **Haute** | **Corriger le fill-engine** : faire respecter à `simulateWeatherEntryFill` le `sizingMode` du bag de la stratégie émettrice. En `fixed_shares`, `qty = fixedShareCount` (capé par `maxPositionSizeUsdc`). Utiliser `getStrategyParams(risk, signal.strategyId)` pour résoudre le bag, pas seulement `ctx.params.entryUsdc`. |
| 2 | **Haute** | **Ajouter un warning de fidélité dédié** (ex. `risk_sizing_mode_ignored`) quand le bag demande `fixed_shares` mais que le moteur taille en USDC — pour rendre l'approximation visible dans `fidelity_warnings` (le warning actuel `risk_sizing_simplified_fixed_usdc` ne le couvre pas). |
| 3 | **Moyenne** | **Config** : aligner `minYesPrice` (ex. 0.5) sur `weather-highest-yes`, cohérent avec `maxYesPrice: 0.61`, pour bloquer les entrées à prix quasi nul. |
| 4 | **Vérification** | Après correctif, relancer la run #40 et vérifier que le PnL simulé s'aligne sur le sizing réel du live (`fixed_shares`). |

---

## 9. Fichiers concernés

| Fichier | Rôle | Impact |
|---------|------|--------|
| `packages/backtest/src/engine/fill-engine.ts` | `simulateWeatherEntryFill` — sizing USDC durcodé | **À corriger** (action 1) |
| `packages/backtest/src/adapters/weather/weather-adapter.ts` | `flushPendingRunnerSimSignals` → appelle le fill-engine avec `ctx.params.entryUsdc` | **À corriger** (action 1) |
| `packages/backtest/src/adapters/weather/adapter-warnings.ts` | Émission des warnings statiques | **À étendre** (action 2) |
| `packages/core/src/weather/strategy-catalog.ts` | `WeatherStrategyParamsBag` — `sizingMode` / `fixedShareCount` | Référence |
| `packages/core/src/sizing/compute.ts` | `computeFixedSharesQuantity` — sizing live correct | Référence (à imiter) |
| `packages/weather-algo/src/processors/weather-entry-pipeline.ts` | Sizing live (`sizingMode` + `fixedShareCount`) | Référence (parité à rétablir) |
| Config DB `weather_algo_strategy_params.weather-highest-yes` | `minYesPrice: null` | **À configurer** (action 3) |

---

## 10. Méthodologie d'audit appliquée

1. **Intégrité** : status `completed`, `engine_version` ≥ 0.6.0, plage/params cohérents.
2. **Fidélité** : chaque `fidelity_warning` analysé — aucun ne doit masquer un vrai bug.
3. **Stats globales** : cohérence mathématique (somme PnL positions == totalPnl).
4. **Répartition des sorties** : dominance anormale de `RESOLUTION`, présence de `BACKTEST_INCOMPLETE_DATA`.
5. **Sizing** : chaque position, taille cohérente avec la config et le prix.
6. **Config vs code** : le bag par-stratégie réel est-il respecté par le moteur ?

Le point 5 (sizing) a révélé le bug : 8 positions de qty > 600 (au lieu de ~19 attendu pour 10 USDC à ~0.5) → investigation → cause racine dans `fill-engine.ts`.
