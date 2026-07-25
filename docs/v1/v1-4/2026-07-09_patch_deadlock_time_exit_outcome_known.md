# Patch — Deadlock sorties UpDown 5m : TIME_EXIT bloqué par `winningTokenId`

**Date** : 2026-07-09
**Version cible** : v1-4
**Statut** : Implémenté
**Tags** : `bug`, `TIME_EXIT`, `PRE_CLOSE`, `crypto-algo`, `UpDown`, `winningTokenId`, `deadlock`, `REDEMPTION`
**Références** :
- Audit BDD position `#18075` — breach SL 98 ticks, `forced_exit_failed_attempts = 0`, REDEMPTION `no_payout`
- `docs/v1/v1-4/2026-07-09_patch_sl_emit_blocked_no_close_bid.md` (complément emitBid)
- `docs/v1/v1-4/2026-07-09_patch_pipeline_sorties_no_liquidity.md` (suppressSlTp)
- `docs/v1/v1-5/2026-07-08_brainstorm_redemption_winning_token_premature.md` (invariant corrigé)

---

## 1. Résumé

Sur les marchés **UpDown 5m**, une position perdante pouvait rester bloquée sans aucune tentative de sortie CLOB alors que le SL était franchi pendant ~79 secondes, puis clôturer en **REDEMPTION** `no_payout`.

**Cause** : trois gardes cumulées créaient un deadlock :

| Garde | Effet |
|-------|--------|
| `shouldSuppressSlTp()` (`acceptingOrders=false`) | SL/TP désactivés |
| `isMarketOutcomeKnown()` → `marketSettled` TIME_EXIT | TIME_EXIT désactivé dès `winningTokenId` dérivé |
| `timeExitInScope` → PRE_CLOSE ignoré | PRE_CLOSE désactivé |

**Correctif** :
1. TIME_EXIT skip uniquement sur `resolved === true` (plus sur `winningTokenId` dérivé).
2. `timeExitInScope` ne mute PRE_CLOSE que si TIME_EXIT peut encore décider (`!marketSettled`).

---

## 2. Cas déclencheur — position #18075

| Champ | Valeur |
|-------|--------|
| Marché | `btc-updown-5m-1783577400` |
| Sens | NO sim, 4.65 @ 0.43 |
| SL | 0.10 bid points → seuil **0.32** |
| Breach | **98 ticks** exec ≤ 0.32 (08:13:36 → 08:14:55) |
| Tentatives SELL | **0** (`forced_exit_failed_attempts = 0`) |
| Clôture | REDEMPTION `no_payout` → **-2.08 pUSD** |
| Marché | `winning_token_id` set, `resolved=false`, `accepting_orders=false` |

---

## 3. Diagramme deadlock (avant patch)

```
SL breach (exec 0.02–0.31)
  ├─ suppressSlTp (acceptingOrders=false) → SL/TP skip
  ├─ isMarketOutcomeKnown (winningTokenId) → TIME_EXIT skip
  └─ timeExitInScope → PRE_CLOSE skip
       → aucune sortie CLOB → REDEMPTION
```

---

## 4. Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `packages/worker/src/processors/strategy/position-exit-evaluator.ts` | `marketSettled: lifecycle?.resolved ?? false` (au lieu de `isMarketOutcomeKnown`) |
| `packages/core/src/risk/exit-decision.ts` | `timeExitInScope` exige `!marketSettled` |
| `packages/core/src/market/lifecycle.ts` | JSDoc `isMarketOutcomeKnown` — plus pour TIME_EXIT |
| `packages/core/src/positions/redemption-wait.ts` | Commentaire invariant TIME_EXIT |
| `packages/core/src/risk/exit-decision.test.ts` | +3 tests deadlock UpDown |

---

## 5. Décisions et non-régression

### Retenu : TIME_EXIT skip = `resolved` uniquement

`winningTokenId` dérivé (prix ≥ 0.99) ne signifie pas que le book du token perdant est à 0/1. Sur #18075, le token NO avait encore des bids exécutables (0.15–0.29) pendant le breach.

Les gagnants restent protégés par `winConfidenceBid` (≥ 0.95) : TIME_EXIT ne force pas la vente d'un quasi-gagnant.

### Rejeté : réactiver SL sous `acceptingOrders=false`

Contredit le patch `no_liquidity` (boucles ITF, 873 échecs pré-patch).

### Rejeté : `isMarketSettled` pour TIME_EXIT

`isMarketSettled` = `closed && !acceptingOrders` → TIME_EXIT aussi mort sur UpDown terminal → deadlock inchangé.

### Complément : patch `emitBid` SL/TRAILING

Même avec TIME_EXIT débloqué, l'émission SL nécessite un `emitBid > 0`. Le patch `sl_emit_blocked` reste nécessaire quand le carnet meurt après la décision.

---

## 6. Compatibilité trading réel

| Étape | Comportement |
|-------|--------------|
| Décision TIME_EXIT | Active pour positions perdantes tant que `resolved=false` |
| Émission signal | Fallback `lastCloseable` / `lastTrade` (SL/TRAILING) ou carnet live |
| Exécution réelle | Re-fetch carnet live ; `no_liquidity` si carnet mort |

Le patch débloque la **décision et l'émission** ; le fill reste conditionné à la liquidité Polymarket réelle.

---

## 7. Tests

| Suite | Résultat |
|-------|----------|
| `packages/core/src/risk/exit-decision.test.ts` | **23/23** (+3 nouveaux) |

Nouveaux tests :
- TIME_EXIT pour position perdante, `marketSettled=false`, `acceptingOrders=false`
- `evaluatePositionExit` : `suppressSlTp` + time-exit → `TIME_EXIT`
- `evaluatePositionExit` : `marketSettled=true` → filet `PRE_CLOSE_LOSS`

---

## 8. Validation post-déploiement

Relancer après redémarrage worker :
```bash
npx tsx tools/_audit-crypto-algo-sl-vwap.ts
npx tsx tools/audit-crypto-algo-exits.ts
```

Critères :
- Nouvelles positions avec breach → `TIME_EXIT` / `SL` / `PRE_CLOSE_*` ou `forced_exit_failed_attempts > 0`
- Plus de hold silencieux type #18075

Les violations historiques (#18075, etc.) restent en BDD — le patch ne rétroagit pas.

---

## 9. Chaîne complète des correctifs v1-4

| Patch | Date | Problème | Statut |
|-------|------|----------|--------|
| `patch_sorties_copy_bid_points_conservative_mark` | 2026-07-08 | `lastTradePrice` stale | ✅ |
| `patch_faux_positifs_sl_executable_bid_ws_filter` | 2026-07-08 | `triggerBidVwap` + `wsBestBid=0.01` | ✅ |
| `patch_pipeline_sorties_no_liquidity` | 2026-07-09 | Boucle no_liquidity, retries, ticks, confirmation SL | ✅ |
| `patch_sl_emit_blocked_no_close_bid` | 2026-07-09 | SL décidé mais jamais émis (`emitBid=0`) | ✅ |
| `patch_deadlock_time_exit_outcome_known` | 2026-07-09 | Deadlock UpDown 5m (TIME_EXIT + suppressSlTp) | ✅ |
| `patch_exit_emit_block_observability` | 2026-07-09 | Blocages pré-émission invisibles + sizedBestBid | ✅ |
