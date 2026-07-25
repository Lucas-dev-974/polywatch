# Brainstorm 3 — Faux positifs SL : `triggerBidVwap` et `wsBestBid = 0.01`

**Date** : 2026-07-08
**Version cible** : v1-4
**Auteur** : Audit BDD + investigation positions sim (conversation 2026-07-08)
**Tags** : `audit`, `SL`, `copy-trading`, `bid-points`, `conservative-mark`, `triggerBidVwap`, `wsBestBid`, `faux-positif`
**Références** :
- `docs/v1/v1-4/2026-07-08_brainstorm_patch_sorties_copy_bid_points_conservative_mark.md`
- `docs/v1/v1-4/2026-07-08_patch_sorties_copy_bid_points_conservative_mark.md`
- `docs/v1/v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md`

---

## 1. Résumé

Malgré le patch v1-4 (filtre de fraîcheur sur `lastTradePrice`), des **faux positifs SL** persistent en copy trading simulation : des positions se ferment par SL alors que le pic de perte est proche de 0 % (voire positif), et le fill réel reste proche du prix d'entrée.

**Deux causes racines identifiées** :

1. **`triggerBidVwap`** utilisé comme prix de décision SL/TP — VWAP pour une quantité de référence (100 shares) artificiellement bas sur carnets peu profonds.
2. **`wsBestBid = 0.01`** inclus dans le conservative mark — micro-bid WebSocket qui corrompt le MIN des candidats de prix.

**Correctifs** : voir `2026-07-08_patch_faux_positifs_sl_executable_bid_ws_filter.md`.

---

## 2. Contexte

Le patch v1-4 avait corrigé les faux positifs causés par un `lastTradePrice` obsolète. L'erreur **E9** (`triggerBidVwap` vs `executableBidVwap`) était documentée comme **hors scope**. Le brainstorm2 (§7 P1) suspectait déjà les `best_bid = 0.01` sans preuve directe dans les ticks.

Cette investigation apporte la preuve BDD et les correctifs pour E9 + wsBestBid.

---

## 3. Cas déclencheur : position #17698 (Choinski vs Rehberg)

| Champ | Valeur |
|-------|--------|
| ID | 17698 |
| Marché | `atp-choinsk-rehberg-2026-07-08` |
| Trader | swisstony |
| Entry | 5.00 @ 0.40 (entry_bid_vwap = 0.39) |
| SL config | 0.2 bid points (seuil = 0.19) |
| Ouverture / fermeture | 14:33:01 → 14:33:02 (**824 ms**) |
| Fill SL | **0.39** (pas 0.19) |
| Peak closure | -4.22 % |
| Perte réalisée | -5.98 % (-0.12 pUSD) |
| Ticks position | **0** |

**Anomalie** : le SL se déclenche en < 1 s alors que le fill (0.39) est quasi égal à l'entry_bid_vwap (0.39). La perte vient du spread + frais, pas d'un crash marché.

### Mécanisme (cause 1 — `triggerBidVwap`)

```
fetchSellExecutablePricesWithDepth(posQty=5, refQty=100)
  executableBidVwap = VWAP(5 shares)   → 0.39  ✅ prix réel de vente
  triggerBidVwap    = MIN(VWAP(5), VWAP(100)) → 0.1145  ❌ artificiel

evaluateLiquidPosition :
  markPrice = getPositionMarkPrice(pos, triggerBidVwap)  // 0.1145
  trigger = (0.1145 - 0.39) / 0.39 × 100 = -70.6 %
  impliedBid = 0.39 × (1 - 0.706) = 0.115
  slBidAbsolute = 0.39 - 0.2 = 0.19
  0.115 <= 0.19 → SL déclenché ❌

Exécution réelle :
  resolveCloseBid(executableBidVwap=0.39) → fill = 0.39
```

Le SL est **déclenché sur un prix fictif** (0.115) mais **exécuté au vrai prix** (0.39).

---

## 4. Audit BDD — 10 positions SL (24 h)

| ID | Slug | Peak | Fill | Durée | Verdict |
|----|------|------|------|-------|---------|
| **17755** | atp-fritz-zverev | **-0.69 %** | 0.72 | 7 min | ❌ Faux positif |
| **17731** | atp-almeida-ribeiro | **+0.66 %** | 0.19 | 17 min | ❌ Faux positif |
| **17749** | wta-lincer-maria | **+0.75 %** | 0.974 | 21 min | ❌ Faux positif |
| **17760** | wta-collins-smit | **+10.5 %** | 0.647 | 7.5 min | ❌ Faux positif |
| **17753** | itf-fondrie-barsuko | **+17.0 %** | 0.59 | 11 min | ❌ Faux positif |
| 17751 | ucl-flo-sab | -4.72 % | 0.34 | 0.8 s | ✅ Légitime |
| 17764 | wta-ishii-cross | -4.32 % | 0.38 | 1.2 s | ✅ Légitime |
| 17747 | mlb-bos-cws | -4.51 % | 0.36 | 15 s | ✅ Légitime |
| 17762 | wta-collins-smit #2 | -6.93 % | 0.331 | 74 s | ✅ Légitime |
| 17745 | kor-gwa-poh | -4.22 % | 0.39 | 30 s | ✅ Légitime |

**5 faux positifs sur 10** — critère : `peak_closure_pnl_percent > -2 %` alors que `close_reason = SL`.

### Cas Zverev (#17755) — utilisateur

- Entry : 7.86 @ 0.7632, entry_bid_vwap = 0.7499
- SL : 0.2 bid points (seuil = 0.5499)
- Peak : **-0.69 %**, fill SL : **0.72**
- `triggerPnl@fill = -3.99 %` — le prix réel n'a **pas** atteint le seuil SL (-26.7 %)
- 20 ticks position : execBid stable à **0.76** pendant toute la vie de la position

---

## 5. Cause 2 — `wsBestBid = 0.01` dans le conservative mark

### Preuve : position #17747 (mlb-bos-cws)

Ticks `market_position_ticks` :

```
+10566ms bid=0.01 execBid=0.36
+13116ms bid=0.36 execBid=0.36
+13670ms bid=0.01 execBid=0.36
+15533ms bid=0.36 execBid=0.36
+17137ms bid=0.01 execBid=0.36
```

Le WebSocket rapporte périodiquement `best_bid = 0.01` alors que `executable_bid_vwap = 0.36` (prix réel stable).

### Mécanisme

```
shouldUseConservativeExitMark({ trigger < -1%, closure < -1% }) → true
resolveExitDecisionMarkPrice({ conservative: true })
  candidates = [bookBid=0.36, wsBestBid=0.01, ...]
  exitMark = MIN(...) = 0.01
  exitSnap.trigger = (0.01 - 0.36) / 0.36 × 100 = -97 % → SL ❌
```

Le `sl_confirmation_ticks = 2` n'aide pas : le carnet reste peu profond, chaque évaluation (100 ms) reproduit le même `wsBestBid = 0.01`.

---

## 6. Synthèse des causes

| # | Cause | Erreur v1-4 | Fichier | Impact |
|---|-------|-------------|---------|--------|
| 1 | `triggerBidVwap` (ref 100 shares) utilisé pour mark SL/TP | **E9** (hors scope) | `position-branches.ts` | SL sur prix fictif, fill au vrai prix |
| 2 | `wsBestBid = 0.01` non filtré dans conservative mark | P1 brainstorm2 (suspecté) | `crypto-algo-exit.ts` | MIN corrompu → SL immédiat |
| 3 | `sl_confirmation_ticks` inefficace si signal constant | — | `position-exit-evaluator.ts` | 2 confirmations en ~200 ms → corrigé (fenêtre 500 ms, patch pipeline) |
| 4 | Fallback emit SL/TRAILING absent quand carnet vide | **E11** | `position-exit-evaluator.ts` | SL décidé, `emitBid=0`, aucune tentative → corrigé (`patch_sl_emit_blocked`) |

---

## 7. Correctifs proposés (implémentés)

Voir le patch : `2026-07-08_patch_faux_positifs_sl_executable_bid_ws_filter.md`.

| Correctif | Description |
|-----------|-------------|
| **P1** | Remplacer `triggerBidVwap` par `executableBidVwap` dans `evaluateLiquidPosition` et `buildPositionExitContext` |
| **P2** | Filtrer `wsBestBid` quand `wsBestBid < bookBid × 0.5` dans `resolveExitDecisionMarkPrice` |

---

## 8. Validation post-patch (2026-07-09)

Audit relancé via `tools/_audit-sl-positions.ts` :

- **20 positions SL** récentes en sim
- **0 faux positif** détecté (tous les fill à 0.01–0.46, mouvements réels)
- **0 missed SL** (aucune position sous seuil sans fermeture)
- **59 positions ouvertes** sans anomalie SL

---

## 9. Recommandations résiduelles

1. ~~**Tick recording à l'ouverture**~~ → ✅ Implémenté (`recordPositionOpen`, patch 2026-07-09).
2. **Monitoring** : le log `warnConservativeMarkDrift` (v1-4) + critère `peak > -2 %` sur fermetures SL pour alerter en prod.
3. **E2E** : test qu'une position copy avec `sl_bid_points: 0.20` ne déclenche pas de SL quand `executableBidVwap` reste à ±1 % de l'entry.
4. ~~**Boucle no_liquidity / retries**~~ → ✅ Patch `2026-07-09_patch_pipeline_sorties_no_liquidity.md`.
5. ~~**SL décidé mais jamais émis** (`emitBid=0`, `forced_exit_failed_attempts=0`)~~ → ✅ Patch `2026-07-09_patch_sl_emit_blocked_no_close_bid.md` (crypto-algo sim, position `#18023`).
6. ~~**Deadlock UpDown 5m** (TIME_EXIT + suppressSlTp)~~ → ✅ Patch `2026-07-09_patch_deadlock_time_exit_outcome_known.md` (position `#18075`).

---

## 10. Références

- **Patch implémenté** : `docs/v1/v1-4/2026-07-08_patch_faux_positifs_sl_executable_bid_ws_filter.md`
- **Patch pipeline sorties** : `docs/v1/v1-4/2026-07-09_patch_pipeline_sorties_no_liquidity.md`
- **Patch émission SL** : `docs/v1/v1-4/2026-07-09_patch_sl_emit_blocked_no_close_bid.md`
- **Patch deadlock UpDown** : `docs/v1/v1-4/2026-07-09_patch_deadlock_time_exit_outcome_known.md`
- **Brainstorm 1** : `docs/v1/v1-4/2026-07-08_brainstorm_patch_sorties_copy_bid_points_conservative_mark.md`
- **Patch 1 (lastTradePrice)** : `docs/v1/v1-4/2026-07-08_patch_sorties_copy_bid_points_conservative_mark.md`
- **Audit 2** : `docs/v1/v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md`
- **Code** : `packages/worker/src/processors/strategy/position-branches.ts`, `packages/core/src/risk/crypto-algo-exit.ts`
