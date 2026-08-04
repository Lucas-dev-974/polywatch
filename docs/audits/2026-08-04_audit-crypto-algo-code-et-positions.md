# Audit crypto-algo — code & historique des positions

**Date** : 2026-08-04
**Périmètre** : packages `crypto-algo`, `worker` (executor + position-exit-evaluator), `core` (risk/tunables/sizing) — et historique complet des positions `ALGO_OPEN`/`ALGO_INCREASE` en base (tables `copied_positions`, `sim_archive_positions`, `executions`, `exit_attempt_events`, `crypto_config`).
**Données** : 9 780 positions archivées (2026-07-11 → 2026-08-04) + 37 positions courantes. Extraction reproductible via `tools/audit-db-*.cjs`.

---

## 1. Résumé exécutif

L'ingénierie est **solide** (fail-closed sur les entrées, gates en couches, idempotence, observabilité des blocages), mais la stratégie **perd de l'argent de façon structurelle** :

- **-601 USDC** cumulés sur 3 834 trades réels (11/07 → 04/08), profit factor **0,83**, drawdown max **666 USDC**.
- Espérance **-0,16 USDC/trade**. Aucun bucket de prix d'entrée n'est profitable sauf 0,85–0,95 (faible volume).
- La jambe **SL concentre 100 % du problème** : -1 763 USDC sur 1 181 trades (avg -1,49), soit ~3× le gain cumulé des jambes gagnantes (TP +512, REDEMPTION +709).
- Session du 04/08 (config actuelle) : **11/11 stop-loss**, -11,60 USDC, certaines positions stoppées **1 à 11 secondes** après l'entrée → sélection adverse sévère à l'entrée.
- Fiabilité des sorties : 83× `forced_exit_retries_exhausted`, 49× SELL FOK `order_not_matched`, 51× `below_min_order_size` — une position est restée **8 minutes** dans une boucle de sortie pendant que le bid passait de 0,54 à 0,13 (23/07).
- Entonnoir d'exécution : **45 %** des positions annulées avant fill, **55 % d'échec** des BUY en mode réel.
- 4 risques **HIGH** côté code (perte de signal de clôture sur panne Redis, throttle de ré-entrée volatil, file d'évaluations non bornée, résultat terminal real non résilient).

**Verdict** : le pipeline est bien construit ; la stratégie `naive-momentum` (bande d'entrée achetant le consensus à 0,50–0,80 sur des marchés binaires court terme) n'a **pas d'edge mesurable** après coûts, et la config actuelle (bande 0,55–0,60, TP off, trailing 0,20/0,20) aggrave l'asymétrie perte/gain. Trader moins, dans des buckets à winrate démontré, ou ne pas trader du tout en l'état.

---

## 2. Architecture (rappel)

```
Polymarket WS book + Gamma poll
  → packages/crypto-algo (StrategyRunner → naive-momentum → pipeline d'entrée)
  → Redis « algo-order-signals »
  → packages/worker (Executor FOK, PositionExitEvaluator SL/TP/trailing/pre-close)
  → PostgreSQL (copied_positions, executions, crypto_config, …)
```

- Signal : `packages/crypto-algo` (process dédié, poll 5 s actuel + WS débouncé).
- Exécution/sorties : `packages/worker` (partagé avec le copy-trading).
- Règles/defaults : `packages/core` (`crypto-algo-tunables`, `crypto-algo-exit`, `sizing`).
- Positions algo : `copied_positions.reason = 'ALGO_OPEN' | 'ALGO_INCREASE'` (pas de table dédiée).

---

## 3. Audit du code

### 3.1 Points forts

- **Entrées fail-closed** : gate de liquidité bilatérale + fraîcheur du book (jamais d'entrée sur book unilatéral/stale), gate MOS avec bump, retry de profondeur, double vérification VWAP (rough puis à quantité cible) — `naive-momentum.strategy.ts:343-374`, `algo-entry-pipeline.ts:135-163, 421-513`.
- **Pipeline d'entrée robuste** : réservation + dedupe logique, reprise sur réservation existante, release systématique sur erreur, modes sim/real indépendants — `algo-entry-pipeline.ts:304-367, 621-648`.
- **Sorties défense en couches** : confirmation SL (N ticks + fenêtre), conservative mark (MIN des sources de bid) avec filtre anti micro-bid, gate MOS, gate forced-exit avec parking, persistance des épisodes de blocage — `crypto-algo-exit.ts:389-453`, `position-exit-evaluator.ts`.
- **Idempotence executor** : claim par position, réconciliation `alreadyInFlight`, settlement sim à 3 niveaux (retry ×3, fallback local, filet finally 15 s).
- **Tunables validés** : bornes min/max par champ, check croisé bande min<max, clamp du lookback sur la capacité du buffer — `crypto-algo-tunables.ts:411-681`.
- **Janitors complets** : closing-watchdog, placing-janitor, pending-entry-janitor, reservation-janitor ; marchés résolus délégués au `market-resolution-watcher` + redemption-handler.
- **Tests** : couverture unitaire sérieuse (strategy, sl-quota, re-entry, exit, tunables, curve gate) + e2e dédiés crypto-algo.

### 3.2 Findings par sévérité

#### HIGH

| # | Finding | Fichier |
|---|---------|---------|
| H1 | **Perte de signal de clôture sur panne Redis** : `emitCloseSignal` sans try/catch ; `lastForcedExitEmitAt` positionné **avant** l'enqueue → le gate cooldown bloque le retry 5 s alors que rien n'a été émis. Sortie SL retardée. | `position-exit-evaluator.ts:451-455, 533-535` |
| H2 | **Re-entry throttle 100 % mémoire, perdu au restart** → revenge-trading possible immédiat après SL ; le filet SL-quota est **désactivé par défaut**. | `strategy-runner.ts:120, 249-278` ; `crypto-algo-tunables.ts:62` |
| H3 | **`evalChains` non borné** : clés conditionId jamais purgées (marchés 5m/15m tournent en permanence) + file sans coalescence si une éval dépasse le debounce → croissance mémoire et travail obsolète. | `strategy-runner.ts:123, 509-525` |
| H4 | **Asymétrie real/sim sur le résultat terminal** : en real, un seul `resultsQueue.enqueue` sans retry ni fallback. Si Redis tombe après un fill réel, la position reste `closing`/`placing` jusqu'au watchdog. Le sim a 3 niveaux de protection, le real zéro. | `executor.ts:231-235, 294` |

#### MEDIUM (sélection)

| # | Finding | Fichier |
|---|---------|---------|
| M1 | TOCTOU re-entry avant fill : deux évals espacées de la latence de fill passent toutes deux → double entrée possible malgré `maxEntries=1`. | `strategy-runner.ts:677-693` |
| M2 | Mutation du singleton de config de stratégie à chaque éval (`applyRiskTunables`) + re-lecture config par sélection → lectures déchirées possibles entre évals concurrentes. | `strategy-runner.ts:287-309, 532-544` |
| M3 | Validation croisée contournable par PATCH partiel : `PATCH {entryPriceMin: 0.97}` avec `entryPriceMax=0.8` en DB passe → bande inversée. Aucun check `slBidPoints < tpBidPoints`. | `crypto-algo-tunables.ts:464-471, 658-681` |
| M4 | Invalidation SL-quota pub/sub best-effort : message perdu → cache périmé jusqu'au TTL → entrée au-delà du quota juste après un SL. | `sl-quota.ts:50, 186-215` |
| M5 | FOK « 99 % » aux unités mélangées : seuil comparé à `signal.quantity * 0.99` alors que `matchQuantity` est recalculé depuis USDC/limite → rejets/acceptations légèrement faux ; un FOK acceptant 1 % de partial est un FAK déguisé. | `executor.ts:507-528` |
| M6 | Erreurs real relabelées `position_lock_timeout` quel que soit le motif → pollution d'observabilité. | `executor.ts:294-299` |
| M7 | Positions « parkées » après épuisement des retries forcés : simple log throttlé, aucune escalade/état DB. | `position-exit-evaluator.ts:137-152` |
| M8 | Divergence mémoire/DB si `clearExitEmitBlock` échoue : l'appelant null les champs en mémoire quand même → âge d'épisode d'alerte faussé. | `position-exit-evaluator.ts:231-238, 314-318` |
| M9 | Fenêtre « marché expiré non résolu » (disputes UMA) : boucle `no_close_bid`, capital verrouillé sans alerte dédiée. | `position-exit-evaluator.ts:479` |
| M10 | Blocage permanent possible d'un marché : exécution SL zombie `pending/submitted` → marché indéfiniment non ré-entrable. | `sl-quota.ts:31-48` |
| M11 | Lectures config ×4 par signal dans l'executor (dont un chemin partiellement mort). | `executor.ts:329-363` |
| M12 | Maps mémoire de l'evaluator jamais purgées hors close (fuite lente). | `position-exit-evaluator.ts:71-78, 97-104` |

#### LOW (extraits)

`LIKE 'ALGO_%'` non échappé (`_` = wildcard SQL) · `slBidPoints: 0` autorisé · `cryptoAlgoWsDebounceMs: 0` accepté (désactive le debounce, aggrave H3) · cleanup Gamma à TTL fixe 30 s ignorant la config · `stop()` ne stoppe pas le janitor · alias d'intervalles acceptés par les parseurs mais rejetés par le validateur · bornes `>`/`>=` incohérentes dans le re-entry throttle · close `already_claimed` silencieux · dust flottant (arrondi 6 décimales puis re-division) · constantes `@deprecated` encore en fallback.

---

## 4. Audit de l'historique des positions

### 4.1 Entonnoir global (9 780 positions archivées, 11/07 → 04/08)

| Étape | n | % |
|---|---|---|
| Positions créées (réservations) | 9 780 | 100 |
| Annulées avant fill (`cancelled`, qty 0) | 4 398 | 45,0 |
| Mortes au stade réservation (`reservation_released/expired`) | 1 354 | 13,8 |
| Non terminales à l'archivage (open/pending/closing/failed) | 194 | 2,0 |
| **Réellement tradées** | **3 834** | **39,2** |

Plus de la moitié des signaux ne produisent jamais une position remplie — bruit opérationnel massif (queues, réservations, janitors) pour 39 % de trades effectifs.

### 4.2 Performance des trades (3 834 trades archivés)

| Indicateur | Valeur |
|---|---|
| Winrate | 51,6 % (1 977 W / 1 858 L) |
| Gain moyen / Perte moyenne | +1,46 / -1,88 USDC (ratio 0,78) |
| **Espérance** | **-0,157 USDC/trade** |
| P&L cumulé | **-601,08 USDC** |
| Profit factor | 0,83 |
| Max win / max loss | +23,46 / -10,84 USDC |
| Drawdown max | 666 USDC (vs +27,73 au pic du 11/07) |
| Durée médiane | 241 s (p10 = 30 s ; 808 trades < 60 s) |

Jours verts : **2 / 18**. La courbe cumulative est monotone descendante à partir du 12/07.

### 4.3 Lecture par jambe de sortie — le cœur du problème

| Jambe | n | P&L total | P&L moyen | Winrate |
|---|---|---|---|---|
| **SL** | 1 181 | **-1 763,32** | -1,49 | 2,3 % |
| REDEMPTION | 1 823 | +708,85 | +0,39 | 74,4 % |
| TP | 415 | +511,90 | +1,23 | 99,0 % |
| TRAILING | 315 | -123,66 | -0,39 | 39,0 % |
| PRE_CLOSE_LOSS / WIN | 45 / 43 | -29,64 / +40,63 | -0,66 / +0,94 | — |
| TIME_EXIT / MANUAL | 9 / 3 | +47,51 / +6,65 | — | — |

- Le **SL moyen (-1,49) coûte plus cher que le TP moyen (+1,23) ne rapporte**, et il frappe ~3× plus souvent.
- Le **trailing stop est perdant en moyenne** (-0,39/trade) : il sort dans le bruit.
- REDEMPTION gagne 74 % du temps mais +0,39 seulement par trade (petites positions, rendement plafonné).

### 4.4 Winrate par bucket de prix d'entrée (archives)

| Bucket entrée | n | Winrate | P&L/trade |
|---|---|---|---|
| 0,45–0,50 | 30 | 26,7 % | -0,37 |
| 0,50–0,55 | 148 | 35,8 % | -0,16 |
| **0,55–0,60** | 1 258 | 45,2 % | **-0,10** |
| 0,60–0,65 | 945 | 46,5 % | -0,16 |
| 0,65–0,70 | 465 | 52,0 % | -0,12 |
| 0,70–0,75 | 530 | 55,3 % | -0,22 |
| 0,75–0,80 | 355 | 60,3 % | -0,24 |
| 0,80–0,85 | 94 | 64,9 % | -0,28 |
| **0,85–0,90** | 26 | **80,8 %** | **+0,22** |
| 0,90–0,95 | 30 | 80,0 % | +0,02 |
| 0,95–1,00 | 54 | 87,0 % | -0,06 |

Le winrate monte avec le prix (le marché est globalement bien pricé), mais **l'espérance reste négative partout** sauf 0,85–0,95. La bande d'entrée actuelle (0,55–0,60) se situe dans le bucket **le plus tradé et structurellement perdant** : acheter le quasi-coin-flip sur des marchés 5–15 min, c'est payer fees + slippage + asymétrie SL pour un edge nul.

### 4.5 Session du 04/08 (config actuelle, sim) — 11/11 SL

Entrées 0,55–0,60, SL à -0,15 bid points, **TP désactivé**, trailing activation à +0,20 (inatteignable en quelques minutes depuis 0,58) :

| Durée avant SL | Occurrences |
|---|---|
| ≤ 11 s | 3 (1 s, 5 s, 11 s) |
| 27–60 s | 5 |
| 115–196 s | 3 |

Des stops déclenchés **1 seconde** après l'entrée = le prix s'effondre immédiatement après l'achat → **sélection adverse** : l'algo achète le ask au moment où le flux vendeur arrive (le filtre « courbe descendante » sur 10 s n'y change rien — le mouvement se produit dans la seconde).

### 4.6 Fiabilité des sorties (`exit_attempt_events`, 304 événements)

| Événement | n | Lecture |
|---|---|---|
| `emit_blocked` SL `forced_exit_retries_exhausted` | 83 | 5 retries FOK épuisés → position parkée |
| `emit_blocked` SL `sl_pending_confirmation` | 85 | confirmation 2 ticks retarde la sortie |
| `emit_blocked` SL `below_min_order_size` | 51 | qty restante < minimum exchange → invendable |
| `execution_failed` SL `order_not_matched` | 30 | FOK non matché (marché en chute) |
| `execution_failed` TRAILING `order_not_matched` | 16 | idem |
| `execution_failed` SL `no_liquidity` | 5 | — |

**Incident 23/07** : position 29298 coincée 8 min dans une boucle `below_min_order_size` → `forced_exit_retries_exhausted` pendant que le bid chutait de 0,54 à 0,13. Cause racine : dust sous le minimum d'ordre Polymarket (5 shares) — le sizing `fixed_shares: 5` actuel rend ce cas **systématique** dès qu'un fill partiel ou des frais rognent la quantité.

### 4.7 Qualité d'exécution des entrées

| Flux | n | Détail |
|---|---|---|
| BUY real échoués | **10/18 (55 %)** | FOK non matchés |
| BUY sim échoués avec slippage 21,7 % | 6 | prix parti entre signal et fill |
| SELL SL échoués (real/sim) | 3 + 4 | dont incident ci-dessus |
| Positions annulées (courantes) | 16/37 | churn de réservations |

### 4.8 Config actuelle vs cohérence (`crypto_config`)

| Paramètre | Valeur | Problème |
|---|---|---|
| `entry_price_min/max` | 0,55 / 0,60 | Bucket historiquement perdant (-0,10/trade) |
| `tp_enabled` | **false** | Aucune jambe de gain active (TP coupé, trailing activation +0,20 inatteignable) |
| `sl_bid_points` | 0,15 | Risque 0,15 pour un gain plafonné → asymétrie défavorable |
| `trailing_bid_points / activation` | 0,20 / 0,20 | Activation jamais atteinte depuis une entrée à 0,55–0,60 |
| `sizing_mode` / `entry_share_count` | `fixed_shares` / 5 | Quantité = minimum exchange → tout fill partiel crée du dust invendable (cf. 4.6) |
| `sim_initial_capital_crypto` | 20 USDC | vs `max_daily_loss_usdc` = 500 → limite journalière 25× le capital, inopérante |
| `min_spread_abs_for_adjustment` | **0,39** | Défaut 0,01 — l'ajustement de seuil au spread est de fait désactivé (passe la validation 0–0,5) |
| `max_entries_per_window` | 2 | TOCTOU M1 : 2 entrées quasi simultanées possibles sur le même marché |
| `poll_ms` | 5 000 | + WS debounce 5 s → fréquence d'évaluation élevée, cf. H3 |

---

## 5. Diagnostic croisé (code × données)

1. **Pas d'edge à l'entrée.** Acheter le consensus (0,50–0,80) sur binaires court terme avec fees + slippage : l'espérance est négative dans tous les buckets sauf 0,85–0,95 (peu de volume). Le « momentum naïf » subit la sélection adverse (SL à 1–11 s).
2. **Asymétrie de sortie destructrice.** SL ~3× plus fréquent que TP et 20 % plus cher ; trailing perdant en moyenne ; TP actuellement désactivé → seule issue gagnante = redemption (74 % WR mais +0,39 avg).
3. **Sizing = minimum exchange.** 5 shares : le moindre rognage (frais, partial fill) produit du dust invendable (`below_min_order_size` ×51, incident du 23/07).
4. **Fragilités d'infrastructure amplifient les pertes** : signaux de clôture perdables (H1), résultats real non résilients (H4), throttle volatil au restart (H2), boucles de sortie parkées sans escalade (M7).
5. **Observabilité bonne mais non exploitée** : les épisodes de blocage sont persistés (83 `retries_exhausted`, 51 `below_min_order_size`) sans alerte exploitée en production.

## 6. Recommandations priorisées

### Immédiat (stop the bleeding)
1. **Désactiver les entrées** (`crypto_algo_enabled=false`) ou resserrer la bande d'entrée vers **0,85–0,95** (seul bucket à espérance positive historique) — et constater que le volume y est faible : envisager l'arrêt pur de la stratégie.
2. **Réactiver le TP** (ou abaisser l'activation du trailing à ~0,05–0,06, les defaults) — en l'état aucune jambe de gain ne peut se déclencher avant redemption.
3. **Augmenter le sizing** (≥ 2× le minimum exchange, ex. 10–15 shares) pour éliminer le dust `below_min_order_size`, ou gérer explicitement le dust en l'agrégeant à la position suivante / en l'acceptant comme perte au redemption.
4. **Corriger `min_spread_abs_for_adjustment`** (0,39 → 0,01) et aligner `max_daily_loss_usdc` sur le capital réel (20 USDC).

### Court terme (fiabilisation, code)
5. **H1** : try/catch sur `emitCloseSignal`, positionner `lastForcedExitEmitAt` **après** enqueue réussi.
6. **H4** : settlement real aussi résilient que le sim (retry + fallback + réconciliation).
7. **H2** : persister le re-entry throttle (Redis) ou activer `sl_quota_enabled` par défaut.
8. **H3** : borner `evalChains` (purge à la désactivation + coalescence « 1 éval pending max par conditionId »).
9. **M3** : validation croisée des bornes contre les valeurs en DB (pas seulement le payload), check `sl < tp`.

### Stratégique
10. **Backtester avant toute réactivation** : le module `optimize-report` existe — l'exécuter sur les 3 834 trades archivés pour valider toute nouvelle bande/SL/TP avant remise en production.
11. **Alerting** sur `exit_attempt_events` (`forced_exit_retries_exhausted`, `below_min_order_size`) et sur « position ouverte sur marché expiré non résolu ».
12. **Mesurer la sélection adverse** : logger le mid 1 s / 5 s / 30 s après chaque entrée (les ticks `algo_price_ticks` existent déjà) pour quantifier le coût d'entrée et décider du sort de la stratégie.

---

## Annexes

- **Reproductibilité** : `node tools/audit-db-explore.cjs` → schéma/comptages ; `audit-db-extract.cjs` → `tools/audit-db-data.json` ; `audit-db-metrics.cjs` → `tools/audit-db-metrics.json` ; `audit-db-exit-events2.cjs` → fiabilité exits ; `audit-db-incident.cjs` → incident 23/07.
- **Outils d'audit existants** : `tools/audit-crypto-algo-exits.ts`, `tools/audit-crypto-algo-exits-detail.ts`.
- **Rapport d'optimisation offline** : `packages/core/src/crypto-algo/optimize-report.ts` (recommandations basées sur les positions clôturées).
