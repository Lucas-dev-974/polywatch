# Audit — Weather algo, placements réels en échec

> **2026-08-28**. Données : table `executions` (`reason LIKE 'WEATHER_%' AND mode = 'real'`).
> Round 1 : slippage tick-aware, book frais `WEATHER_OPEN`, BUY ceil / SELL floor, `orderType: FAK`.
> Round 2 : bump `MIN_ORDER_USDC`, REST book avant POST, +1 tick `WEATHER_OPEN`, label UI.

## 1. Constat BDD

| Mode | Filled | Failed | Taux d'échec |
|------|--------|--------|--------------|
| **real** | 0 | 25 | **100 %** |
| sim | 22 | 5 | 19 % |

Répartition **real** (tous `WEATHER_OPEN` BUY, `requested_qty = 5`, `strategy_id = weather-forecast`) :

| `error` | n | % |
|---------|---|---|
| `order_not_matched` | 19 | 76 % |
| `slippage_exceeded` | 4 | 16 % |
| `no_liquidity` | 2 | 8 % |

`clob_order_id` est NULL sur les 25 lignes. Pour `slippage_exceeded` / `no_liquidity` c'est attendu (échec **avant** POST CLOB, dans `prepareFakMarketOrder`). Pour `order_not_matched` le POST a eu lieu mais la réponse CLOB n'a pas fourni d'`orderID` persisté (FAK unmatched / zero fill).

Les mêmes `condition_id` se remplissent en **sim** (fill = `reference_vwap`, slippage 0) et échouent en **real**. `reference_vwap` réel : **0.01–0.23**.

Config globale : `max_slippage_percent = 7`. Config real weather-forecast : `sizingMode = fixed_shares`, `fixedShareCount = 5`.

## 2. Vérification point par point (audit initial)

| Affirmation initiale | Verdict | Correction |
|----------------------|---------|------------|
| 100 % d'échec real (25/25) | **Confirmé** | — |
| SIM ~81 % de fill vs REAL 0 % | **Confirmé** | — |
| Cause slippage : 7 % incompatible avec 1 tick à 1–5 ¢ | **Confirmé** | Ex. id 89305 : ref 0.04 → 25 % = **1 tick**. id 89292 : ref 0.02, slippage 100 %. |
| Cause `order_not_matched` : GTC converti en FAK, il faudrait poster en GTC | **Rejeté** | Le protocole projet est **FAK/FOK uniquement** (`docs/plans/POLYMARKET_PROTOCOL_VERIFICATION_PLAN.md` : GTC « Non utilisé »). Copy envoie `FAK`, crypto `FOK`. Weather était le **seul** pipeline à poser `GTC`, déjà remapé en FAK par `RealExecutor` (`orderType === 'FOK' ? FOK : FAK`). Un vrai GTC resting n'a **pas** de cycle de vie (cancel, TTL, capital lock). |
| `clob_order_id` NULL = ordre jamais envoyé | **Partiel** | Vrai pour slippage / no_liquidity. Faux pour `order_not_matched` (échec **après** POST, fill 0). |
| Cause 3 : marchés structurellement illiquides → filtrer YES &lt; 0.05 | **Trop agressif** | `weather-forecast` **cible** les long-shots (edge = forecast − prix marché). Un plancher 5 ¢ tuerait une grande partie de la stratégie. Les 2 `no_liquidity` sont un book vide au prepare, pas un argument pour un filtre prix. |
| Book frais manquant pour weather | **Omis dans l'audit initial, réel** | `ENTRY_BUY_PREPARE_REASONS` avait `COPY_OPEN` / `ALGO_OPEN` mais **pas** `WEATHER_OPEN`. Sans `maxAgeMs`, `fetchBook` renvoie **n'importe quel** cache local, même stale → limite FAK trop basse → unmatched. |

### Causes racines retenues

1. **Slippage % fixe vs tick CLOB** — à 4 ¢, 1 tick (0.01) = 25 % ≫ 7 %.
2. **Book stale au prepare** — `WEATHER_OPEN` absent du set « book frais 15 s ».
3. **Arrondi nearest sur un BUY FAK** — `roundToTick` peut poster **sous** l'ask → FAK unmatched.
4. **`orderType: 'GTC'` weather** — cosmétique / piège de lecture ; le CLOB recevait déjà du FAK. Aligné sur `FAK` (comme copy). **Pas** un passage à du GTC resting.

Le décalage sim/real s'explique : le sim FAK matche le book **local** (souvent le même snapshot que `referenceVwap`) ; le real FAK matche le CLOB **live**, plus le stale + l'arrondi down + le guard 7 %.

## 3. Solutions retenues (et ce qui a été écarté)

| # | Solution | État |
|---|----------|------|
| A | Slippage tick-aware : `max(maxSlippagePercent, MIN_SLIPPAGE_TICKS × tick / ref × 100)`, `MIN_SLIPPAGE_TICKS = 2` | **Livré** |
| B | Poster des GTC resting | **Écarté** — hors modèle d'exécution |
| B′ | `orderType: 'FAK'` dans l'entry pipeline weather | **Livré** (alignement copy) |
| C | Filtre `roughAskVwap < 0.05` | **Écarté** — trop agressif pour best-edge |
| D | `WEATHER_OPEN` dans `ENTRY_BUY_PREPARE_REASONS` (book ≤ 15 s) | **Livré** |
| E | BUY `ceilToTick` / SELL `floorToTick` (ne pas rater le côté taker) | **Livré** |

Les 4 `slippage_exceeded` 1–2 ticks passent A. Le cas 90.9 % à ref 0.22 (~20 ticks) **reste bloqué**. Les `order_not_matched` sont attaqués par D + E (limite = ask **courant** arrondi **vers le haut**).

## 4. Fichiers

- `packages/worker/src/execution/slippage-guard.ts`
- `packages/worker/src/clob/prepare-fak-order.ts`
- `packages/worker/src/clob/tick-size.ts`
- `packages/worker/src/constants.ts` (`MIN_SLIPPAGE_TICKS`)
- `packages/weather-algo/src/processors/weather-entry-pipeline.ts`

## 5. Round 2 (après FAK + tick-aware) — 2026-08-28

Même session, exécutions `id > 89316` (orderType déjà `FAK`) : **9 tentatives, 0 fill**. Positions weather real : 34 `cancelled`, 0 `open`.

| `error` | n | Détail |
|---------|---|--------|
| `order_not_matched` | 6 | ref 0.14 / 0.21 / 0.26 ; qty 5 ; `clob_order_id` NULL |
| `no_liquidity` | 2 | ref 0.001 |
| `slippage_exceeded` | 1 | ref 0.24, 8.33 % = exactement 2 ticks |

L'UI mappe `order_not_matched` vers **« aucun acheteur (marché illiquide) »** — libellé de **sortie SELL**, trompeur sur un BUY (il n'y a pas d'acheteur à trouver ; le FAK n'a pas croisé de **vendeur** au prix).

Les mêmes marchés se remplissent en **sim**. Un GET CLOB REST au moment de l'audit montre un ask (ex. Austin 0.14 size 20, Ankara 0.21 size 55) et `min_order_size = 5`. Crypto real `ALGO_OPEN` FOK **fill** à 0.47–0.63 (5 shares ≈ 2.3–3.1 USDC). Weather 5 × 0.14 = **0.70 USDC < `MIN_ORDER_USDC` (1)** — copy et crypto skip déjà ce plancher en real ; weather ne le faisait pas.

### Causes round 2

1. **Notionnel sous le minimum live** — `fixedShareCount = 5` sur un YES à 14 ¢ → 0.70 USDC. Le CLOB FAK ne matche pas (ou ne persiste pas d'`orderID`).
2. **Book prepare ≤ 15 s de cache** — le worker ne faisait pas de REST `forceRefreshBook` **immédiatement** avant le POST real (le sim, lui, refresh au T1).
3. **Limite pile à l'ask** — sur un carnet YES fin, un FAK *at-touch* reste unmatched ; +1 tick taker après le guard slippage.
4. **Label UI** — `order_not_matched` n'est pas « aucun acheteur ».

### Correctifs round 2

| # | Solution | État |
|---|----------|------|
| F | Bump qty real pour notionnel ≥ `MIN_ORDER_USDC` ; skip si cash / `maxPositionSizeUsdc` insuffisant | **Livré** |
| G | `forceRefreshBook` REST avant `prepareFakMarketOrder` dans `RealExecutor` | **Livré** |
| H | BUY `WEATHER_OPEN` : +1 tick après le slippage guard (le pad n'est pas compté comme un mouvement de marché) | **Livré** |
| I | Label UI `ordre FAK non matché (pas de contrepartie au prix)` | **Livré** |

Toujours **pas** de GTC resting. Redémarrer worker + weather-algo pour activer.

Fichiers round 2 : `weather-entry-pipeline.ts`, `real-executor.ts`, `prepare-fak-order.ts`, `packages/frontend/src/lib/execution.ts`.

