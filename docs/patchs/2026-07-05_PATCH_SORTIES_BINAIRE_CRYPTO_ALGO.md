# Patch : Sorties binaires crypto-algo — settled, mark stale, TP plafonné

**Date** : 2026-07-05  
**Statut** : **P0 + P1 + P2 implémentés**  
**Contexte** : Audit `../audits/2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md`  
**Objectif** : Éliminer les REDEMPTION en perte totale, améliorer TIME_EXIT sur mark stale, rendre le TP atteignable sur tokens [0, 1].

---

## 1. Résumé

| # | Patch | Priorité | Type | Statut |
|---|---|---|---|---|
| 0 | Config DB (overrides NULL, hold_if_winning) | **P0** | Migration SQL | **Implémenté** |
| 1a | Évaluation sorties malgré `settled` | **P1** | Code worker + core | **Implémenté** |
| 1b | Mark stale (liquid + illiquid) | **P1** | Code core/worker | **Implémenté** |
| 2 | TP plafonné au gain max vers 1,0 | **P2** | Code core | **Implémenté** |

**Hors scope** (différer) :
- Refonte SL/TP en points de probabilité absolus
- Réduction trailing 5m
- Élargissement fenêtre pre-close (TIME_EXIT couvre déjà T-90s)

---

## 2. Patch P0 — Configuration DB

### Problème

Overrides globaux masquent `CRYPTO_INTERVAL_EXIT_DEFAULTS` ; `pre_close_hold_if_winning = true` retient les positions en pre-close.

### Changement

Migration `AddCryptoAlgoExitDefaults1700000000024` :

```sql
UPDATE risk_config SET
  crypto_algo_sl_percent = NULL,
  crypto_algo_tp_percent = NULL,
  crypto_algo_trailing_stop_percent = NULL,
  crypto_algo_trailing_activation_percent = NULL,
  crypto_algo_pre_close_hold_if_winning = false,
  crypto_algo_pre_close_enabled = true,
  crypto_algo_pre_close_seconds = NULL,
  crypto_algo_time_exit_enabled = true;
```

### Effet

| Avant | Après |
|---|---|
| SL 15 % global | SL **12 %** sur 5m |
| TP 50 % global | TP **45 %** sur 5m |
| hold_if_winning true | Pre-close perdantes active (fenêtre T-120s / T-90s) |

---

## 3. Patch P1a — Sorties après `settled` (chaîne complète)

### Problème

Après `closed && acceptingOrders = false`, `evaluateLiquidPosition` / `evaluateIlliquidPosition` ne appelaient plus `evaluateCloseLogic`. De plus, **quatre gardes** bloquaient les sorties même si on retirait le early-return :

| Garde | Fichier | Ancien comportement |
|---|---|---|
| `if (settled) return tick` | `position-branches.ts` | Pas d'éval sortie |
| `shouldSuppressSlTp` sur terminal | `redemption-wait.ts` | SL/TP supprimés |
| `marketSettled` dans TIME_EXIT | `exit-decision.ts` | TIME_EXIT null |
| `isTimeExitScope` post-endDate + `acceptingOrders=false` | `policy.ts` | Fenêtre TIME_EXIT fermée |

### Règle unifiée (post-patch)

> Tant que l'issue n'est **pas connue** (`resolved` ou `winningTokenId`) **et** qu'un prix vendable existe, les sorties CLOB (SL / TIME_EXIT) restent actives.  
> Suppression SL/TP uniquement quand `isMarketOutcomeKnown(lifecycle)`.

### Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/worker/.../position-branches.ts` | Continuer `runOpenPositionExitEval` si `open` + `canStillExitViaClob()` |
| `packages/worker/.../position-evaluator.ts` | Helper `canStillExitViaClob` |
| `packages/core/.../redemption-wait.ts` | `shouldSuppressSlTp` : outcome connu seulement |
| `packages/core/.../lifecycle.ts` | `isMarketOutcomeKnown()` |
| `packages/core/.../exit-decision.ts` | TIME_EXIT : `marketSettled` = outcome connu |
| `packages/core/.../policy.ts` | `isTimeExitScope` : reste actif une fois la fenêtre dure entrée |
| `packages/worker/.../position-exit-evaluator.ts` | Passe `isMarketOutcomeKnown` au TIME_EXIT |

### Note audit 16029

Le miss SL à -27 % / -50 % dans T-120s / T-90s est **probablement** dû à l'instabilité pipeline pré-patch ; la cause `settled` s'applique surtout **après** `endDate`.

---

## 4. Patch P1b — Mark stale (liquid + illiquid)

### Problème

- Illiquid : `bookBid > 0` retourné sans comparer à `lastTradePrice` / `lastCloseableBid`.
- Liquid : `getPositionMarkPrice` utilisé pour trigger/closure sans mark conservateur.

### Changement

**`crypto-algo-exit.ts`** :
- `shouldUseConservativeExitMark()` → true si illiquid, PnL négatif, ou fenêtre TIME_EXIT
- `resolveExitDecisionMarkPrice(..., { conservative })` → `Math.min(candidates)` quand conservateur

**`position-branches.ts`** :
- Recalcule `exitSnap` via mark conservateur avant `runOpenPositionExitEval` (liquid **et** illiquid settled)

---

## 5. Patch P2 — TP plafonné

### Problème

Le TP en % est inatteignable pour les entries hautes (ex. entry 0.70, TP 45% → bid 1.015 > 1.0). Le patch P2 ajoute un plafond `min(entryBidVwap + tpBidPoints, 0.99)` pour que le TP reste atteignable.

### Changement

**`packages/core/src/risk/policy.ts`** :
- `BINARY_TP_BID_CAP = 0.99` (constante)
- `tpBidAbsolute = Math.min(entryBidVwap + tpBidPoints, BINARY_TP_BID_CAP)`

---

## 6. Ordre d'implémentation

```
P0 (migration)
  ↓
P1a + P1b (code + tests)
  ↓
Re-audit DB (1 session 5m complète)
  ↓
P2 si nécessaire
```

---

## 7. Validation

```bash
npm run test -w @polywatch/core -- crypto-algo-exit policy exit-decision lifecycle redemption-wait
npm run test -w @polywatch/worker -- position-exit-evaluator position-branches
npx tsx tools/audit-crypto-algo-exits.ts
npx tsx tools/audit-redemption-sl-miss.ts
```

### Critères de succès (session sim 5m)

| Critère | Seuil |
|---|---|
| REDEMPTION `no_payout` en perte | **0** |
| REDEMPTION total | **< 5 %** |
| Violations SL (ticks) | **0** |
| SL + TIME_EXIT + TP | **> 90 %** |

### Non-régression

- REDEMPTION `filled` à 1,0 quand CLOB fermé sans bid : inchangée
- `shouldSuppressSlTp` : actif sur **outcome connu** (`resolved` / `winningTokenId`), pas sur terminal seul
- Pre-close : toujours désactivé quand `isMarketSettled` (terminal)
- Sim balance : pas de double-comptabilisation

---

## 8. Rollback

| Patch | Rollback |
|---|---|
| P0 | `down()` migration ou restaurer SL 15, TP 50, hold_if_winning true |
| P1 | Revert git du PR |

---

## 9. Fichiers impactés

| Fichier | Patch |
|---|---|
| `packages/core/src/migrations/AddCryptoAlgoExitDefaults1700000000024.ts` | P0 |
| `packages/core/src/database/data-source.ts` | P0 |
| `packages/core/src/mark/lifecycle.ts` | P1a |
| `packages/core/src/positions/redemption-wait.ts` | P1a |
| `packages/core/src/risk/policy.ts` | P1a, P2 |
| `packages/core/src/risk/exit-decision.ts` | P1a |
| `packages/core/src/risk/crypto-algo-exit.ts` | P1b |
| `packages/worker/.../position-evaluator.ts` | P1a |
| `packages/worker/.../position-branches.ts` | P1a, P1b |
| `packages/worker/.../position-exit-evaluator.ts` | P1a |
| Tests associés | P1 |

---

## 10. Références

- Audit : `../audits/2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md`
- Defaults intervalle : `packages/core/src/risk/crypto-algo-exit.ts` → `CRYPTO_INTERVAL_EXIT_DEFAULTS`
