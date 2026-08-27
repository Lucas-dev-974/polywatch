# Patch — Faux positifs SL : `executableBidVwap` + filtre `wsBestBid`

**Date** : 2026-07-08
**Version cible** : v1-4
**Statut** : ✅ Implémenté
**Tags** : `bug`, `SL`, `copy-trading`, `bid-points`, `conservative-mark`, `triggerBidVwap`, `wsBestBid`, `faux-positif`
**Référence** : `docs/v1/v1-4/2026-07-08_brainstorm3_faux_positifs_sl_trigger_bid_ws.md`

---

## 1. Résumé

Les positions **copy trading simulation** se fermaient par SL alors que le marché n'avait pas réellement chuté (peak proche de 0 %, fill proche de l'entry).

**Deux causes corrigées** :

1. **`triggerBidVwap`** (MIN du VWAP position et VWAP ref 100 shares) utilisé comme prix de décision — artificiellement bas sur carnets peu profonds.
2. **`wsBestBid = 0.01`** inclus dans le conservative mark — micro-bid WebSocket corrompant le MIN des candidats.

**Corrections** :

- Utiliser **`executableBidVwap`** (vrai prix de vente) pour les décisions SL/TP.
- Exclure **`wsBestBid`** du conservative mark quand `wsBestBid < bookBid × 0.5`.

---

## 2. Fichiers modifiés

| Fichier | Modification | Erreur corrigée |
|---------|-------------|-----------------|
| `packages/worker/src/processors/strategy/position-branches.ts` | `evaluateLiquidPosition` : `markPrice` basé sur `executableBidVwap` au lieu de `triggerBidVwap` | **E9** |
| `packages/worker/src/processors/strategy/position-branches.ts` | `buildPositionExitContext` : `resolveExitDecisionMarkPrice` reçoit `executableBidVwap` | **E9** |
| `packages/core/src/risk/crypto-algo-exit.ts` | Constante `WS_BEST_BID_MIN_RATIO = 0.5` + filtre wsBestBid anormal | **P1** (brainstorm2) |
| `packages/core/src/risk/crypto-algo-exit.test.ts` | 3 nouveaux tests pour le filtre wsBestBid | régression |

---

## 3. Modifications détaillées

### 3.1 `evaluateLiquidPosition` — prix de mark SL/TP

**Fichier** : `packages/worker/src/processors/strategy/position-branches.ts`

**Avant** :
```typescript
const markPrice = getPositionMarkPrice(
  pos,
  bookPrices.triggerBidVwap ?? bookPrices.executableBidVwap,
  lifecycle,
);
```

**Après** :
```typescript
const markPrice = getPositionMarkPrice(
  pos,
  bookPrices.executableBidVwap,
  lifecycle,
);
```

**Justification** : `triggerBidVwap` est le MIN entre le VWAP pour la quantité de la position et le VWAP pour `MARKET_TICK_REF_QTY` (100 shares par défaut). Sur un carnet peu profond, le VWAP 100 shares peut être très bas (ex. 0.1145) alors que le prix réel de vente (5 shares) est 0.39. Le SL doit se baser sur le **prix auquel la position peut réellement être vendue**.

### 3.2 `buildPositionExitContext` — mark de décision exit

**Fichier** : `packages/worker/src/processors/strategy/position-branches.ts`

**Avant** :
```typescript
const exitMark = resolveExitDecisionMarkPrice(
  pos,
  bookPrices.triggerBidVwap ?? bookPrices.executableBidVwap,
  lifecycle,
  ...
);
```

**Après** :
```typescript
const exitMark = resolveExitDecisionMarkPrice(
  pos,
  bookPrices.executableBidVwap,
  lifecycle,
  ...
);
```

**Note** : `triggerBidVwap` reste passé à `evaluateCloseLogic` via `bookPrices.triggerBidVwap` pour les décisions time-exit / pre-close (`decisionMarkBid`). Seule la **décision SL/TP** utilise désormais `executableBidVwap`.

### 3.3 `resolveExitDecisionMarkPrice` — filtre wsBestBid anormal

**Fichier** : `packages/core/src/risk/crypto-algo-exit.ts`

**Constante ajoutée** :
```typescript
const WS_BEST_BID_MIN_RATIO = 0.5;
```

**Avant** :
```typescript
if (wsBestBid != null && wsBestBid > 0) candidates.push(wsBestBid);
```

**Après** :
```typescript
if (wsBestBid != null && wsBestBid > 0) {
  const isAnomalous = bookBid > 0 && wsBestBid < bookBid * WS_BEST_BID_MIN_RATIO;
  if (!isAnomalous) {
    candidates.push(wsBestBid);
  }
}
```

**Comportement** :
- `bookBid = 0.36`, `wsBestBid = 0.01` → **exclu** (0.01 < 0.36 × 0.5)
- `bookBid = 0.36`, `wsBestBid = 0.34` → **inclus** (0.34 ≥ 0.18)
- `bookBid = 0`, `wsBestBid = 0.01` → **inclus** (pas de référence book, carnet illiquide)

---

## 4. Tests

| Suite | Résultat |
|-------|----------|
| `packages/core/src/risk/crypto-algo-exit.test.ts` | 31/31 ✅ (+3 nouveaux) |
| `packages/worker/src/processors/strategy/position-branches.test.ts` | 4/4 ✅ |
| `packages/worker/src/processors/strategy/position-exit-evaluator.test.ts` | 15/15 ✅ |

> **Mise à jour 2026-07-09** : la suite `position-exit-evaluator.test.ts` compte désormais **23 tests** (+4 pipeline no_liquidity, +4 emit SL — voir `patch_sl_emit_blocked_no_close_bid`).

### Nouveaux tests (`crypto-algo-exit.test.ts`)

1. **`filters anomalously low wsBestBid when bookBid is reliable`** — wsBestBid=0.01 exclu quand bookBid=0.36
2. **`includes wsBestBid when it is close to bookBid (not anomalous)`** — wsBestBid=0.34 conservé quand bookBid=0.36
3. **`includes wsBestBid when bookBid is 0 (no reference to compare)`** — compat illiquide

---

## 5. Impact et risques

### Ce qui est corrigé

| Scénario | Avant | Après |
|----------|-------|-------|
| Carnet peu profond, VWAP ref << VWAP position | SL sur prix fictif | SL sur executableBidVwap |
| WS best_bid = 0.01, execBid = 0.36 | conservative mark = 0.01 → SL | wsBestBid filtré, mark = 0.36 |
| Position Zverev peak -0.69 % | Fermée par SL | Ne se déclenche plus |

### Risques résiduels

| Risque | Probabilité | Mitigation |
|--------|-------------|------------|
| Vrai crash masqué si wsBestBid légitimement < 50 % bookBid | Faible | `lastTradePrice` frais et `lastCloseableBidVwap` restent dans les candidats |
| Carnet illiquide (bookBid=0) sans filtre wsBestBid | N/A | Comportement inchangé — wsBestBid toujours inclus |
| Flash crash réel à 0.01 avec bookBid confirmé | Très faible | SL légitime si executableBidVwap chute aussi |

### Non modifié (hors scope)

- `triggerBidVwap` reste calculé et passé à `evaluateCloseLogic` pour time-exit / pre-close
- `sl_confirmation_ticks` (config UI) — complément utile mais insuffisant seul si le signal est constant
- Tick recording à l'ouverture (positions avec 0 ticks)

---

## 6. Validation BDD

**Audit post-patch** (2026-07-09, `tools/_audit-sl-positions.ts`) :

- 20 positions SL récentes — **0 faux positif**
- Tous les fill prices très bas (0.01–0.46) = mouvements réels
- 0 missed SL
- 59 positions ouvertes sans anomalie

Comparaison avant/après :

| Métrique | Avant patch | Après patch |
|----------|-------------|-------------|
| Faux positifs SL (24 h) | 5/10 (50 %) | 0/20 (0 %) |
| Critère peak > -2 % + SL | 5 positions | 0 position |

---

## 7. Chaîne de correctifs v1-4

| Patch | Date | Problème | Statut |
|-------|------|----------|--------|
| `patch_sorties_copy_bid_points_conservative_mark` | 2026-07-08 | `lastTradePrice` stale | ✅ |
| `patch_faux_positifs_sl_executable_bid_ws_filter` | 2026-07-08 | `triggerBidVwap` + `wsBestBid=0.01` | ✅ |
| `patch_pipeline_sorties_no_liquidity` | 2026-07-09 | Boucle no_liquidity, retries, ticks, confirmation SL | ✅ |
| `patch_sl_emit_blocked_no_close_bid` | 2026-07-09 | SL décidé mais jamais émis (`emitBid=0`) | ✅ |
| `patch_deadlock_time_exit_outcome_known` | 2026-07-09 | Deadlock UpDown 5m (TIME_EXIT + suppressSlTp) | ✅ |

Erreurs v1-4 brainstrom 1 :

| Erreur | Statut après ce patch |
|--------|----------------------|
| E3, E4, E7 (lastTradePrice stale) | ✅ Corrigé (patch 1) |
| E9 (triggerBidVwap vs executableBidVwap) | ✅ Corrigé (ce patch) |
| E10 (logging drift) | ✅ Déjà en place (patch 1) |
| P1 wsBestBid=0.01 (brainstorm2) | ✅ Corrigé (ce patch) |

---

## 8. Références

- **Brainstorm** : `docs/v1/v1-4/2026-07-08_brainstorm3_faux_positifs_sl_trigger_bid_ws.md`
- **Brainstorm 1** : `docs/v1/v1-4/2026-07-08_brainstorm_patch_sorties_copy_bid_points_conservative_mark.md`
- **Patch 1** : `docs/v1/v1-4/2026-07-08_patch_sorties_copy_bid_points_conservative_mark.md`
- **Audit 2** : `docs/v1/v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md`
- **Code** :
  - `packages/worker/src/processors/strategy/position-branches.ts` (l.105, l.432)
  - `packages/core/src/risk/crypto-algo-exit.ts` (`WS_BEST_BID_MIN_RATIO`, `resolveExitDecisionMarkPrice`)
  - `packages/worker/src/processors/strategy/trigger-bid.ts` (inchangé, toujours utilisé pour ref)
