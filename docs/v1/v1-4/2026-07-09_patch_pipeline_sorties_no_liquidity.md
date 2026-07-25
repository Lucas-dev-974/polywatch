# Patch — Pipeline de sortie : no_liquidity, retries globaux, ticks ouverture, confirmation SL

**Date** : 2026-07-09
**Version cible** : v1-4
**Statut** : ✅ Implémenté (+ correctifs post-audit 2026-07-09)
**Tags** : `bug`, `SL`, `TP`, `copy-trading`, `no_liquidity`, `forced-exit`, `sl_confirmation_ticks`, `market_position_ticks`
**Références** :
- `docs/v1/v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md` (audit P0/P1)
- `docs/v1/v1-4/2026-07-09_patch_sl_emit_blocked_no_close_bid.md` (complément : émission SL bloquée à `emitBid=0`)
- `docs/v1/v1-4/2026-07-09_patch_deadlock_time_exit_outcome_known.md` (deadlock UpDown 5m TIME_EXIT)
- Plan : correction des 4 problèmes restants de la pipeline de sortie

---

## 1. Résumé

Quatre problèmes restants après les patches v1-4 (faux positifs SL) ont été corrigés :

| # | Problème | Correctif |
|---|----------|-----------|
| 1 | Boucle `no_liquidity` (873 échecs SELL, dont 767 TP) | Suppression SL/TP quand `acceptingOrders=false` |
| 2 | `sim_sl_close_max_retries` contourné (strategy ré-émet à chaque tick) | Compteur global persisté + cooldown 5 s |
| 3 | Positions sans tick à l'ouverture | `addPosition()` + `recordPositionOpen()` au fill BUY |
| 4 | `sl_confirmation_ticks=2` inefficace (~100 ms) | Fenêtre minimale 500 ms + reset après émission |

**Audit BDD pré-patch (2026-07-09)** : 873 échecs `no_liquidity`, 5 positions ITF avec 98–236 tentatives TP chacune, 3 positions bloquées en `closing`.

---

## 2. Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `packages/core/src/positions/redemption-wait.ts` | `shouldSuppressSlTp()` : `acceptingOrders === false` suffit (sans attendre `endDate`) |
| `packages/core/src/orders/forced-exit.ts` | **Nouveau** — helpers partagés (`FORCED_EXIT_CLOSE_REASONS`, inclut **TP**) |
| `packages/core/src/entities/CopiedPosition.ts` | Colonnes `forced_exit_failed_attempts`, `last_forced_exit_attempt_at` |
| `packages/core/src/migrations/AddForcedExitAttemptTracking1700000000034.ts` | Migration |
| `packages/core/src/services/execution.service.ts` | Incrément compteur sur échec retryable ; reset sur fill |
| `packages/core/src/services/copied-position.service.ts` | `reconcileClosingOnClosedClob()` au démarrage |
| `packages/worker/src/processors/strategy/position-exit-evaluator.ts` | Cooldown 5 s, garde global retries, confirmation SL 500 ms |
| `packages/worker/src/processors/results-consumer.ts` | Tracking ticks ; garde global retries + `shouldSuppressSlTp` sur retry |
| `packages/worker/src/processors/market-tracking/market-tick-recorder.ts` | `recordPositionOpen()` |
| `packages/worker/src/processors/strategy-processing.ts` | `clearExitState()` |
| `packages/worker/src/index.ts` | Wiring tracker/recorder ; réconciliation startup |
| `packages/worker/src/constants.ts` | `FORCED_EXIT_RETRY_COOLDOWN_MS`, `SL_CONFIRMATION_MIN_WINDOW_MS` |
| `packages/worker/src/execution/sl-close-retry.ts` | Réutilise helpers core |

---

## 3. Fix 2 — Suppression SL/TP quand CLOB fermé

### `shouldSuppressSlTp()` — avant / après

**Avant** : suppression uniquement si `resolved` **ou** (`endDate` passé **ET** `acceptingOrders=false`).

**Après** : suppression si `resolved` **ou** `acceptingOrders === false` (quel que soit `endDate`).

**Cas déclencheur** : match ITF reporté (`end_date` futur, `accepting_orders=false`) → 767 échecs TP `no_liquidity`.

### Réconciliation au démarrage

`reconcileClosingOnClosedClob()` : positions `closing` sur marchés `accepting_orders=false` → revert `open` + annulation exécutions en vol.

---

## 4. Fix 1 — Compteur global de tentatives forcées

### Colonnes BDD

- `forced_exit_failed_attempts` (int, default 0)
- `last_forced_exit_attempt_at` (timestamptz, nullable)

### Incrément (échec retryable)

Dans `ExecutionService.finalizeExecution()` quand un SELL forcé (`SL`, `TP`, `TRAILING`, etc.) échoue avec `no_liquidity` / `order_not_matched` / `tick_size_fetch_failed`.

### Garde strategy (`PositionExitEvaluator`)

- Bloque émission si `forcedExitFailedAttempts >= sim_sl_close_max_retries`
- Cooldown **5 s** entre émissions (`FORCED_EXIT_RETRY_COOLDOWN_MS`)
- Throttle Map in-memory `lastForcedExitEmitAt` (complète le timestamp BDD)

### Garde results-consumer (post-audit)

`maybeRetryForcedExitClose()` vérifie aussi :
- `shouldSuppressSlTp()` → pas de retry si CLOB fermé
- `forcedExitFailedAttempts >= maxRetries` → pas de retry si quota global épuisé
- Retry **TP** inclus (auparavant exclus de `isForcedExitSignal`)

---

## 5. Fix 4 — Confirmation SL robuste

- Compteur `{ count, firstAt }` au lieu d'un simple entier
- Conditions : `count >= slConfirmationTicks` **ET** `now - firstAt >= 500 ms`
- Reset du compteur après émission (évite re-émission immédiate à chaque tick)
- `clearPositionState()` appelé à la fermeture via `ResultsConsumer.setOnPositionClosed()`

---

## 6. Fix 3 — Tick recording à l'ouverture

- `ResultsConsumer.syncPositionTracking()` : `addPosition()` + `recordPositionOpen()` au fill BUY
- `removePosition()` + `clearExitState()` à la fermeture
- `recordPositionOpen()` : tick immédiat avec VWAP pour la quantité de la position (bypass throttle 500 ms)

---

## 7. Correctifs post-audit (2026-07-09)

| ID | Type | Problème | Correction |
|----|------|----------|------------|
| BF1 | Fantôme | `results-consumer` retry contournait le compteur global | Garde `forcedExitFailedAttempts >= maxRetries` |
| BF2 | Fantôme | Retry TP/SL sur CLOB fermé malgré suppress | Garde `shouldSuppressSlTp()` dans retry |
| BF3 | Fantôme | Maps `slConfirmations` / `lastForcedExitEmitAt` / `lastEval` jamais nettoyées | `clearPositionState()` à la fermeture |
| RF1 | Refactor | Commentaire `lifecycle.ts` obsolète | Mis à jour |

---

## 8. Tests

| Suite | Résultat |
|-------|----------|
| `@polywatch/core` (vitest) | **450/450** passés |
| `@polywatch/worker` (vitest) | **139/139** passés |
| `tsc -p tsconfig.json` (core + worker) | OK |

Nouveaux tests ciblés :

| Fichier | Couverture |
|---------|------------|
| `packages/core/src/positions/redemption-wait.test.ts` | +1 test `acceptingOrders=false` avant endDate |
| `packages/core/src/orders/forced-exit.test.ts` | 3 tests helpers partagés |
| `packages/core/src/services/execution.service.test.ts` | +1 test compteur forced exit |
| `packages/worker/src/processors/strategy/position-exit-evaluator.test.ts` | +4 tests pipeline (confirmation SL, cooldown, exhausted) ; +4 tests emit SL (patch `sl_emit_blocked`, total **23**) |

---

## 9. Risques résiduels

| Risque | Mitigation actuelle | Piste future |
|--------|---------------------|--------------|
| SL non exécutable sur marché UpDown 5m post-résolution | Attente REDEMPTION | Fallback slippage / forced close |
| `acceptingOrders=false` temporaire (maintenance CLOB) | SL/TP suspendu jusqu'à réouverture | Monitoring + alerte UI |
| Positions « parkées » après 5 échecs | Redemption quand marché résolu | Dashboard positions à risque |
| SL **décidé** mais signal jamais émis (`emitBid=0`, `forced_exit_failed_attempts=0`) | ✅ Corrigé par `patch_sl_emit_blocked_no_close_bid` | — |
| Deadlock UpDown 5m (TIME_EXIT + suppressSlTp + PRE_CLOSE) | ✅ Corrigé par `patch_deadlock_time_exit_outcome_known` | — |

---

## 10. Chaîne complète des correctifs v1-4

| Patch | Date | Problème | Statut |
|-------|------|----------|--------|
| `patch_sorties_copy_bid_points_conservative_mark` | 2026-07-08 | `lastTradePrice` stale | ✅ |
| `patch_faux_positifs_sl_executable_bid_ws_filter` | 2026-07-08 | `triggerBidVwap` + `wsBestBid=0.01` | ✅ |
| `patch_pipeline_sorties_no_liquidity` | 2026-07-09 | no_liquidity loop, retries, ticks, confirmation SL | ✅ |
| `patch_sl_emit_blocked_no_close_bid` | 2026-07-09 | SL décidé mais jamais émis (`emitBid=0`) | ✅ |
| `patch_deadlock_time_exit_outcome_known` | 2026-07-09 | Deadlock UpDown 5m (TIME_EXIT + suppressSlTp) | ✅ |

---

## 11. Références code

- `packages/core/src/positions/redemption-wait.ts` — `shouldSuppressSlTp()`
- `packages/core/src/orders/forced-exit.ts`
- `packages/worker/src/processors/strategy/position-exit-evaluator.ts`
- `packages/worker/src/processors/results-consumer.ts`
- `packages/worker/src/processors/market-tracking/market-tick-recorder.ts`
