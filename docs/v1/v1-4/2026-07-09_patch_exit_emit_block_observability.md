# Patch — Observabilité des sorties bloquées à l'émission (+ emit sizedBestBid)

**Date** : 2026-07-09
**Version cible** : v1-4
**Statut** : Implémenté
**Tags** : `observability`, `SL`, `TIME_EXIT`, `emitBid`, `crypto-algo`, `dashboard`
**Références** :
- Audit session post-reset (#18121) — REDEMPTION `no_payout`, `forced_exit_failed_attempts = 0`
- `docs/v1/v1-4/2026-07-09_patch_sl_emit_blocked_no_close_bid.md`
- `docs/v1/v1-4/2026-07-09_patch_deadlock_time_exit_outcome_known.md`

---

## 1. Résumé

Les sorties forcées **décidées** mais **non émises** (gates pré-enqueue) ne laissaient aucune trace en BDD. Impossible de diagnostiquer #18121 après coup.

**Correctifs** :
1. Persister les blocages pré-émission (`last_exit_block_*`, `first_exit_block_at`, compteur).
2. Alerte dashboard crypto-algo + `notifyBackendAlert` (dedup) si blocage critique ≥ 30 s.
3. Emit phase B **encadrée** : `sizedBestBid` (niveau size > 0) **après** `lastCloseable`, avec garde ratio 50 %.

---

## 2. Schéma

Colonnes `copied_positions` (migration `AddExitEmitBlockTracking1700000000035`) :

| Colonne | Rôle |
|---------|------|
| `last_exit_block_reason` | Motif (`no_close_bid`, `below_min_order_size`, …) |
| `last_exit_block_close_reason` | `SL` / `TIME_EXIT` / … |
| `first_exit_block_at` | Début d'épisode (alerte ≥ 30 s) |
| `last_exit_block_at` | Dernière observation |
| `exit_emit_blocked_count` | Incréments throttlés (~5 s) |

**Clear** : fill forced-exit (`fillDelta > 0`), clôture terminale, ou `closeReason` redevient null. **Pas** sur enqueue Redis.

---

## 3. Emit — sizedBestBid (phase B)

Priorité `resolveCloseBid` :

```
executableBidVwap → liveBestBid → persistedBid → lastCloseable (frais)
  → sizedBestBid (size > 0, pas < 50 % de lastCloseable)
  → lastTrade frais (évaluateur)
```

`maxSizedBidPrice` ignore les niveaux size=0. `resolveLiveCloseableBid` accepte aussi `sizedBestBid`.

---

## 4. Alertes

- Frontend : `deriveCryptoAlgoHealthAlerts` scanne positions open-like avec blocage critique ≥ 30 s.
- Worker : `notifyBackendAlert` warning, cooldown 5 min / position.
- Exclus : `forced_exit_cooldown`, `sl_pending_confirmation`, `in_flight_buy`.

---

## 5. Fichiers

| Zone | Fichiers |
|------|----------|
| Core | `CopiedPosition`, migration `0035`, `exit-emit-block.ts`, `copied-position.service.ts`, `execution.service.ts`, `crypto-algo-exit.ts` |
| Worker | `position-exit-evaluator.ts`, `close-bid.ts`, `connection-manager.ts`, `strategy-processing.ts`, `position-branches.ts` |
| Frontend | `position.ts`, `crypto-algo-health.ts`, `useCryptoAlgoDashboard.ts`, `CryptoAlgoPage.tsx` |
| Tools | `audit-crypto-algo-exits.ts` |

---

## 6. Non-régression

- `shouldSuppressSlTp` / décision SL / filtre E9 inchangés
- `lastCloseable` reste prioritaire sur micro-bid 0.01
- Clear pas sur enqueue (évite faux négatif après MOS revert)

---

## 7. Validation

```bash
npx tsx tools/audit-crypto-algo-exits.ts
```

Chercher sections `EXIT EMIT BLOCKS` et `REDEMPTION WITH PRIOR EMIT BLOCKS`.
