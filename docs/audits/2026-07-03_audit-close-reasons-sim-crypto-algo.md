# Audit : Pourquoi toutes les positions sim crypto-algo sont clôturées par REDEMPTION

**Date** : 2026-07-03  
**Auteur** : Hermes Agent  
**Portée** : Crypto-algo en mode simulation (`mode = 'sim'`, `reason = 'ALGO_OPEN'`)  
**Méthodologie** : Analyse statique du code (`crypto-algo`, `worker`, `core`) + audit de la DB PostgreSQL via `tools/audit-db-direct.ts`

---

## 1. Constat

Sur l'ensemble des positions sim crypto-algo fermées en DB :

| Métrique | Valeur |
|---|---|
| Positions sim fermées | 22 |
| Close reason : `REDEMPTION` | 22 (100%) |
| Close reason : `SL` | 0 |
| Close reason : `TP` | 0 |
| Close reason : `TRAILING` | 0 |
| Close reason : `PRE_CLOSE_LOSS` (filled) | 0 |
| Sells `PRE_CLOSE_LOSS` en status `failed` | 948 |
| Durée moyenne position (open → close) | 335s – 980s (5 à 16 min) |
| Marchés concernés | `btc-updown-5m`, `eth-updown-5m`, `xrp-updown-5m` (marchés 5 minutes) |

**Aucune position n'est jamais fermée par SL, TP, trailing ou pre-close. Toutes le sont par redemption.**

---

## 2. Configuration actuelle (DB `risk_config`)

| Paramètre | Valeur | Source |
|---|---|---|
| `crypto_algo_enabled` | `true` | Algo actif |
| `crypto_algo_strategies` | `["naive-momentum"]` | Stratégie unique |
| `crypto_algo_sl_percent` | `30` | SL à -30% |
| `crypto_algo_tp_percent` | `null` | TP désactivé |
| `crypto_algo_trailing_stop_percent` | `null` | Trailing désactivé |
| `crypto_algo_pre_close_enabled` | `null` | Hérite du mode |
| `crypto_algo_pre_close_seconds` | `null` | Hérite du mode |
| `sim_sl_tp_enabled` | `true` | SL/TP sim activé |
| `sim_sl_percent` | `40` | SL sim par défaut |
| `sim_tp_percent` | `300` | TP sim par défaut |
| `sim_pre_close_enabled` | `true` | Pre-close sim activé |
| `sim_pre_close_seconds` | `40` | Fenêtre pre-close : 40s avant fin |
| `sim_pre_close_hold_if_winning` | `true` (défaut) | Retient les positions gagnantes |

Colonnes SL/TP sur les positions (`copied_positions`) :

| Champ | Valeur (toutes les positions sim) |
|---|---|
| `sl_percent` | `30` (hérité de `crypto_algo_sl_percent`) |
| `tp_percent` | `null` (crypto-algo override null → hérite `sim_tp_percent = 300`, mais… voir §3.3) |
| `trailing_stop_percent` | `null` |
| `trailing_activation_percent` | `null` |

---

## 3. Root cause : 3 problèmes en cascade

### 3.1 Marchés 5min → SL/TP trop large pour trigger

Tous les marchés sont des **marchés "Up or Down" à 5 minutes** (`btc-updown-5m-*`, `eth-updown-5m-*`, `xrp-updown-5m-*`).

- La position est ouverte à ~2-3 min de la fin du marché.
- Le SL est à **30%** (`crypto_algo_sl_percent = 30`). Sur un marché 5min avec un entry à 0.60, le bid doit chuter de 0.60 → 0.42 (−30%) pour que le SL trigger.
- Sur des marchés crypto 5min, le prix bouge mais **rarement de 30% en 5 minutes** — sauf cas extrême.
- Le TP est à `null` (crypto-algo override) → hériterait `sim_tp_percent = 300`, soit +300%. Inatteignable en 5 min.

**→ Le SL/TP n'a jamais la possibilité de trigger dans la fenêtre de vie du marché.**

### 3.2 `suppressSlTp` désactive le SL/TP dès que le marché expire

`packages/worker/src/processors/strategy/position-exit-evaluator.ts:98-99` :

```typescript
const suppressSlTp =
  lifecycle != null && isMarketAwaitingRedemptionExit(lifecycle);
```

`packages/core/src/positions/redemption-wait.ts:27-37` :

```typescript
export function isMarketAwaitingRedemptionExit(
  market: MarketLifecycleState | null | undefined,
  now = Date.now(),
): boolean {
  if (!market) return false;
  if (isMarketTerminal(market)) return true;
  if (market.resolved) return true;
  if (market.winningTokenId) return true;
  if (market.endDate && market.endDate.getTime() <= now) return true;
  return false;
}
```

Pour un marché 5min, le `endDate` passe très vite (~5 min après l'open de la position). Une fois le marché expiré :

1. `isMarketAwaitingRedemptionExit()` retourne `true`
2. `suppressSlTp = true` → **le SL/TP/trailing est complètement désactivé**
3. Seule `evaluatePreCloseExit` reste évaluable, mais…

**→ Dès que le marché passe `endDate`, le SL/TP est mort. La position ne peut plus être fermée que par pre-close ou redemption.**

### 3.3 Pre-close émis mais échoue systématiquement à l'exécution

Le pre-close **est bien déclenché** (948 signaux `PRE_CLOSE_LOSS` en sim !), mais ils **tous échouent** (`status: failed`).

Le flux d'exécution (`packages/worker/src/processors/executor.ts:197-276`) :

1. `position-exit-evaluator.ts` détecte la fenêtre pre-close → émet signal `PRE_CLOSE_LOSS` dans la `closeQueue`
2. `executor.ts` → `simulateFill()` essaie de simuler un sell contre le book
3. Mais à ce moment-là, le marché est **déjà expiré/illiquide** :
   - `book` est `null` → `failedExecution(signal, 'no_liquidity')`
   - Ou `fillPrice <= 0` → `failedExecution(signal, 'no_liquidity')`
   - Ou `shouldAbortPreCloseForWinningFill` retourne `true` → `pre_close_hold_winning`

Avec `sim_pre_close_seconds = 40`, le pre-close se déclenche 40s avant la fin. Mais :

- La table `CRYPTO_INTERVAL_PRE_CLOSE_SECONDS` (`crypto-algo-exit.ts:16-24`) recommande **120s** pour du `5m`
- Comme `crypto_algo_pre_close_enabled = null` et `crypto_algo_pre_close_seconds = null`, l'override n'est pas activé
- Le système hérite de `sim_pre_close_seconds = 40` au lieu des 120s recommandés
- À 40s de la fin, le book est déjà vidé par les market-makers
- Le sell ne matche rien → échec

De plus, `preCloseHoldIfWinning = true` (défaut) fait que si le fill serait non-négatif, l'exécution est avortée :

`packages/worker/src/processors/executor.ts:300-314` :
```typescript
if (await shouldAbortPreCloseForWinningFill(...)) {
  return failedExecution(signal, 'pre_close_hold_winning');
}
```

**→ Le pre-close est émis au bon moment, mais le book est déjà parti et/ou le hold-if-winning annule l'exécution.**

### 3.4 La redemption finit par tout fermer

`packages/worker/src/processors/redemption-handler.ts:33-57` :

```typescript
async processAll(): Promise<void> {
  const pending = await this.positionService.loadPendingResolution();
  for (const pos of pending) {
    await this.redeem(pos.id, ...);
  }
  // Clean up failed positions whose market has resolved.
  const failed = await this.positionService.loadFailed();
  for (const pos of failed) {
    await this.redeem(pos.id, ...);
  }
}
```

Le `RedemptionHandler` scanne les positions `pending_resolution` et `failed` toutes les 15s (`REDEMPTION_LOOP_MS = 15_000`). Une fois le marché résolu :

1. Les positions `failed` (échec de pre-close) sont rattrapées par la redemption
2. Le payoff est crédité directement (0 ou 1 par share)
3. La position est fermée avec `close_reason = 'REDEMPTION'`

**→ La redemption est le path de fallback qui ferme systématiquement tout ce que le SL/TP/pre-close n'a pas pu fermer.**

---

## 4. Chronologie type d'une position sim

```
t=0     Position ouverte (ALGO_OPEN, marché 5min, entry ≈ 0.60)
        ↓ SL/TP actifs, threshold -30%/+300%
        ↓ Marché en cours, book liquide

t+2min  market.endDate arrive
        ↓ isMarketAwaitingRedemptionExit() = true
        ↓ suppressSlTp = true → SL/TP désactivé
        ↓ Pre-close évalué (40s avant endDate)

t+2min  PRE_CLOSE_LOSS émis dans closeQueue
        ↓ executor.ts → simulateFill()
        ↓ Book déjà vide (market expiré) → 'no_liquidity' ou 'pre_close_hold_winning'
        ↓ Échec. Position reste 'open' ou passe 'failed'

t+5-10min  Marché résolu (winning_token_id set)
           ↓ RedemptionHandler.processAll() scanne pending_resolution + failed
           ↓ redeem() → crédite payoff (0 ou 1)
           ↓ Position fermée : close_reason = 'REDEMPTION'
```

---

## 5. Distribution des close reasons en DB

```
SIM close_reason distribution
┌──────────────┬─────┐
│ close_reason │ cnt │
├──────────────┼─────┤
│ REDEMPTION   │ 22  │  ← 100%
└──────────────┴─────┘

SIM SELL execution reasons
┌──────────────┬───────────┬──────┐
│ reason       │ status    │ cnt  │
├──────────────┼───────────┼──────┤
│ PRE_CLOSE_LOSS │ failed  │ 948  │  ← tous échouent
│ REDEMPTION   │ filled    │ 11   │
│ REDEMPTION   │ no_payout │ 11   │
└──────────────┴───────────┴──────┘
```

---

## 6. Recommandations

### 6.1 Rapprocher le SL de la volatilité réelle des marchés 5min

**Problème** : `crypto_algo_sl_percent = 30` est inadapté pour du 5min. Un mouvement de 30% en 5 min est extrême.

**Fix** : Réduire le SL à **10-15%** pour les marchés 5min, soit via :
- `UPDATE risk_config SET crypto_algo_sl_percent = 15;`
- Ou mieux : implémenter un SL par interval dans la table `CRYPTO_INTERVAL_PRE_CLOSE_SECONDS` (ou une table similaire pour le SL)

### 6.2 Activer l'override pre-close crypto-algo

**Problème** : `crypto_algo_pre_close_enabled = null` et `crypto_algo_pre_close_seconds = null` → hérite de `sim_pre_close_seconds = 40` au lieu des 120s recommandés par la table d'interval.

**Fix** :
```sql
UPDATE risk_config
SET crypto_algo_pre_close_enabled = true,
    crypto_algo_pre_close_seconds = 120;
```

Cela donne 120s au pre-close pour exécuter un sell avant que le book ne disparaisse.

### 6.3 Revoir le `suppressSlTp` pour les marchés courts

**Problème** : `isMarketAwaitingRedemptionExit()` retourne `true` dès que `endDate` passe, ce qui désactive le SL/TP **avant** que la redemption soit possible. Sur des marchés 5min, la fenêtre entre `endDate` et la résolution effective peut être de plusieurs minutes — pendant lesquelles le SL/TP est désactivé sans alternative viable.

**Fix possible** :
- Ne pas supprimer le SL/TP tant que le marché n'est pas `resolved` ou `winningTokenId` set
- Ou : ne supprimer le SL/TP que quand `isMarketTerminal()` (CLOB réellement fermé, 404) plutôt qu'au simple passage de `endDate`
- Le cas `endDate <= now` seul pourrait être trop agressif

### 6.4 Le pre-close échoue car le book est vide → utiliser le last-trade price comme fallback

**Problème** : Le `simulateFill()` échoue car le book est vide après `endDate`. Mais le `resolveExitDecisionMarkPrice()` (`crypto-algo-exit.ts:159-201`) a déjà prévu un fallback sur le `lastTradePrice` — sauf que ce fallback n'est utilisé que pour la **décision** d'émettre le signal, pas pour l'**exécution** du sell.

**Fix possible** : Pour le mode sim, si le book est vide au moment du pre-close mais qu'un last-trade price récent existe, simuler le fill à ce prix au lieu d'échouer.

### 6.5 Activer le TP crypto-algo

**Problème** : `crypto_algo_tp_percent = null` → hérite `sim_tp_percent = 300` (inatteignable en 5min).

**Fix** :
```sql
UPDATE risk_config SET crypto_algo_tp_percent = 50;
```
Un TP à 50% sur un marché 5min permet de prendre des gains réalistes.

### 6.6 Désactiver `pre_close_hold_if_winning` pour les marchés courts

**Problème** : `preCloseHoldIfWinning = true` (défaut) empêche le pre-close de s'exécuter si le fill serait non-négatif. Sur des marchés 5min où la position peut basculer de gagnante à perdante en quelques secondes, retenir la position est risqué.

**Fix** :
```sql
UPDATE risk_config SET crypto_algo_pre_close_hold_if_winning = false;
```

---

## 7. Impact business

L'impact actuel est que **toutes les positions sim crypto-algo sont hold-to-redemption**, ce qui signifie :

- **Aucune gestion du risque** : le SL ne protège jamais les positions
- **Aucune prise de profit** : le TP ne sécurise jamais les gains
- **PnL binaire** : chaque position se termine à payoff 0 (perte totale) ou 1 (gain total), comme une option binaire pure, sans gestion intermédiaire
- **Le pre-close gaspille des cycles** : 948 signaux émis pour 0 exécution réussie
- **L'audit comptable est faussé** : le `realized_pnl` ne reflète que des payoffs 0/1, pas de gestion de position active

---

## 8. Fichiers analysés

| Fichier | Rôle |
|---|---|
| `packages/core/src/risk/policy.ts` | `evaluateSlTpTrailing()` — décision SL/TP/trailing |
| `packages/core/src/risk/exit-decision.ts` | `evaluatePositionExit()` — orchestrateur SL/TP + pre-close |
| `packages/core/src/risk/crypto-algo-helpers.ts` | `getCryptoAlgoExitParams()` — override SL/TP algo |
| `packages/core/src/risk/crypto-algo-exit.ts` | Pre-close params par interval, mark price fallback |
| `packages/core/src/positions/redemption-wait.ts` | `isMarketAwaitingRedemptionExit()` — gate suppressSlTp |
| `packages/worker/src/processors/strategy/position-exit-evaluator.ts` | Évaluation SL/TP/pre-close par position |
| `packages/worker/src/processors/strategy/position-branches.ts` | Branches liquid/illiquid, appel exit evaluator |
| `packages/worker/src/processors/strategy/position-evaluator.ts` | Calcul trigger/closure/unrealized PnL |
| `packages/worker/src/processors/strategy-processing.ts` | Hot path : fetch positions → evaluate → emit signals |
| `packages/worker/src/processors/executor.ts` | `simulateFill()` — exécution sim, pre-close hold guard |
| `packages/worker/src/processors/redemption-handler.ts` | `processAll()` — redemption fallback |
| `packages/worker/src/clob/pre-close-hold-guard.ts` | `shouldAbortPreCloseForWinningFill()` |
| `packages/crypto-algo/src/processors/algo-entry-pipeline.ts` | Entry pipeline, reservation avec SL/TP |
| `packages/crypto-algo/src/strategy/strategy-runner.ts` | Évaluation stratégies, signaux BUY |
| `packages/crypto-algo/src/strategy/implementations/naive-momentum.strategy.ts` | Stratégie momentum, entry-only |
| `tools/audit-db-direct.ts` | Outil d'audit DB utilisé |