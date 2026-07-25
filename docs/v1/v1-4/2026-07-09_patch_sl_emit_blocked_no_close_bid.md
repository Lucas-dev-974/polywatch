# Patch — SL bloqué à l'émission (`emitBid = 0`)

**Date** : 2026-07-09
**Version cible** : v1-4
**Statut** : Implémenté
**Tags** : `bug`, `SL`, `TRAILING`, `crypto-algo`, `copy-trading`, `emitBid`, `lastCloseableBid`, `lastTradePrice`
**Références** :
- Audit BDD algo sim (conversation 2026-07-09) — position `#18023` : breach SL prolongé, `forced_exit_failed_attempts = 0`, clôture `REDEMPTION` / `no_payout`
- `docs/v1/v1-4/2026-07-08_patch_faux_positifs_sl_executable_bid_ws_filter.md` (E9 — ne pas régresser)

---

## 1. Résumé

Des stop-loss **décidés** par le mark conservateur (`exitMark`) n'étaient **jamais émis** lorsque le carnet live était vide (`executableBidVwap = 0`, pas de `wsBestBid`), car le fallback d'émission (`lastCloseableBid`, `lastTradePrice` frais) n'était autorisé que pour `TIME_EXIT` et `PRE_CLOSE_*`.

Sur les marchés crypto 5m, le carnet se vide souvent avant la redemption → log `exit signal blocked — no close bid`, aucune tentative SELL, hold jusqu'à `REDEMPTION`.

**Correctifs** :
1. Étendre les fallbacks d'émission à `SL` et `TRAILING`.
2. Toujours tenter un fetch CLOB pour les positions `open`, même sur marché terminal.

---

## 2. Cause racine

```
Décision SL  → exitSnap.trigger depuis resolveExitDecisionMarkPrice (conservative mark)
Émission SL  → resolveCloseBid(executableBidVwap, wsBestBid) sans lastCloseable
             → emitBid = 0 si carnet vide
             → aucun enqueue, forced_exit_failed_attempts reste à 0
```

Le patch v1-4 (E9) avait correctement basé la **décision** sur `executableBidVwap` (qty position) pour éviter les faux positifs `triggerBidVwap`. Ce patch corrige la **phase d'émission** sans revenir à E9.

---

## 3. Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `packages/worker/src/processors/strategy/position-exit-evaluator.ts` | `allowLastCloseableFallback` et `canUseFreshLastTradeFallback` étendus à `SL` / `TRAILING` |
| `packages/worker/src/processors/strategy-processing.ts` | Fetch CLOB conservé pour `pos.status === 'open'` même si marché terminal |
| `packages/worker/src/processors/strategy/position-exit-evaluator.test.ts` | Tests emit SL via lastCloseable / lastTrade ; garde stale ; non-régression E9 |

---

## 4. Détail — fallback d'émission SL/TRAILING

**Avant** : `resolveCloseBid(..., allowStaleLastBid)` true uniquement pour `PRE_CLOSE_*`. `freshLastTrade` fallback uniquement pour `TIME_EXIT` / `PRE_CLOSE_*`.

**Après** : pour `SL` et `TRAILING` :
- `allowStaleLastBid = true` → utilise `lastCloseableBidVwap` si frais (≤ 60 s, `isLastCloseableBidFresh`)
- si toujours `closeBid === 0`, utilise `lastTradePrice` frais (même règle d'âge que TIME_EXIT)

Le prix de fill reste le bid de secours réel — pas un VWAP ref-qty fictif.

---

## 5. Détail — fetch sur marché terminal

**Avant** : `isMarketTerminal` → `bookPrices = { executableBidVwap: 0, ... }` sans fetch.

**Après** : fetch systématique ; court-circuit à zéro seulement si fetch vide **et** position non-`open` **et** marché terminal.

Les positions `open` sur marchés `closed && acceptingOrders=false` peuvent encore lire un bid résiduel avant passage illiquid + fallbacks.

---

## 6. Non-régression

- **E9** : la décision SL reste sur `executableBidVwap` / conservative mark — pas de retour à `triggerBidVwap` pour le mark.
- **`shouldSuppressSlTp`** : inchangé (`acceptingOrders=false` supprime SL/TP pour éviter boucles `no_liquidity`).
- **Filtre `wsBestBid`** : inchangé (`WS_BEST_BID_MIN_RATIO`).

---

## 7. Tests

| Suite | Résultat |
|-------|----------|
| `packages/worker/src/processors/strategy/position-exit-evaluator.test.ts` | **23/23** ✅ (+4 nouveaux) |

Nouveaux tests :
- SL émis via `lastCloseableBidVwap` frais quand book/WS vides
- SL émis via `lastTradePrice` frais en dernier recours
- Pas d'émission si `lastCloseable` périmé et aucun autre bid
- Pas de SL quand trigger/closure ne franchissent pas le seuil (garde E9 côté evaluator)

---

## 8. Compatibilité trading réel Polymarket

Ce patch corrige la **phase d'émission** du signal (`emitBid` → enqueue). Il ne modifie pas l'exécuteur CLOB.

### Pipeline réel (`RealExecutor`)

À l'exécution, le worker **re-fetch toujours le carnet live** (`fetchSellExecutablePrices`) et poste un ordre **FAK** au prix courant. Le `referenceVwap` du signal (issu de `lastCloseableBid` ou `lastTradePrice`) sert surtout au **slippage guard** et aux logs — ce n'est pas le prix garanti de fill.

| Étape | Comportement |
|-------|--------------|
| Décision SL | Mark conservateur (`exitMark`) — inchangé (E9) |
| Émission signal | Fallback `lastCloseableBid` / `lastTradePrice` frais si carnet vide — **nouveau** |
| Exécution réelle | Re-fetch carnet live ; `fillPrice = executableBidVwap` |
| Carnet vide à l'exec | `no_liquidity` — ordre non posté |
| Carnet revenu entre décision et exec | Fill possible |

### Différence sim vs réel

| | Simulation | Trading réel Polymarket |
|---|------------|-------------------------|
| Patch permet d'**émettre** le SL | ✅ | ✅ |
| Fill sans carnet | ❌ → `no_liquidity` (aligné live ; plus de fallback `lastTradePrice`) | ❌ → `no_liquidity` |
| Fill si liquidité réelle au moment de l'exec | ✅ | ✅ |

**Conclusion** : le patch est compatible avec le trading réel (même pipeline FAK + carnet live). Il débloque les **tentatives** quand le carnet était vide à l'évaluation mais peut encore exister à l'exécution. Si le carnet reste mort jusqu'à la redemption, l'ordre échouera en `no_liquidity` — comportement attendu, mais au moins visible (`forced_exit_failed_attempts > 0`) au lieu d'un hold silencieux.

Références code :
- `packages/worker/src/clob/real-executor.ts` — re-fetch live, `no_liquidity` si `fillPrice <= 0`
- `packages/worker/src/processors/executor.ts` — sim locale FAK ; book vide → `no_liquidity` (pas de fill `lastTradePrice`)

---

## 9. Validation post-déploiement

Voir aussi `2026-07-09_patch_exit_emit_block_observability.md` (persistance des blocages pré-émission).

Relancer l'audit algo sim (`tools/audit-crypto-algo-exits.ts`) et vérifier :
- positions perdantes avec breach prolongé → au moins une tentative `SELL` reason=`SL` avant `REDEMPTION`
- `forced_exit_failed_attempts > 0` ou fill SL sur ces cas (plus de hold silencieux jusqu'à `no_payout`)

---

## 10. Chaîne complète des correctifs v1-4

| Patch | Date | Problème | Statut |
|-------|------|----------|--------|
| `patch_sorties_copy_bid_points_conservative_mark` | 2026-07-08 | `lastTradePrice` stale | ✅ |
| `patch_faux_positifs_sl_executable_bid_ws_filter` | 2026-07-08 | `triggerBidVwap` + `wsBestBid=0.01` | ✅ |
| `patch_pipeline_sorties_no_liquidity` | 2026-07-09 | Boucle no_liquidity, retries, ticks, confirmation SL | ✅ |
| `patch_sl_emit_blocked_no_close_bid` | 2026-07-09 | SL décidé mais jamais émis (`emitBid=0`) | ✅ |
| `patch_deadlock_time_exit_outcome_known` | 2026-07-09 | Deadlock UpDown 5m (TIME_EXIT + suppressSlTp) | ✅ |

### Distinction avec les autres patches

Le patch `patch_pipeline_sorties_no_liquidity` adresse les positions qui **tentent** de vendre mais échouent (`no_liquidity`, retries, CLOB fermé). Ce patch adresse les positions qui **ne tentent même pas** : décision SL prise, mais signal bloqué à l'émission faute de bid live ni fallback autorisé.

Le patch `patch_deadlock_time_exit_outcome_known` adresse le cas où **aucune** voie de sortie (SL, TIME_EXIT, PRE_CLOSE) n'est active sur UpDown 5m malgré un breach prolongé.
