# Brainstorm 2 — Audit BDD : Conformité SL/TP Copy Trading Simulation post-patch

**Date** : 2026-07-08
**Version cible** : v1-4
**Auteur** : Audit BDD via `tools/` (analyze-config, audit-db-direct, audit-summary, _audit-sl-full, _audit-sl-positions, audit-redemption-sl-miss, verify-sim-cash)
**Tags** : `audit`, `SL`, `TP`, `copy-trading`, `bid-points`, `conservative-mark`, `redemption`, `no-liquidity`, `cash-reconciliation`
**Référence** : `docs/v1/v1-4/2026-07-08_brainstorm_patch_sorties_copy_bid_points_conservative_mark.md`

---

## 1. Résumé

Audit complet de la base de données pour vérifier la conformité des SL/TP sur les positions **copy trading simulation** après l'implémentation du patch de filtre de fraîcheur sur `lastTradePrice`.

**7 outils d'audit exécutés** sur la BDD PostgreSQL (TypeORM) :
- `analyze-config.ts` — Configuration RiskConfig
- `audit-db-direct.ts` — Audit complet (positions, exécutions, cash)
- `audit-summary.ts` — Résumé global
- `_audit-sl-full.ts` — Audit SL complet (positions SL, missed SL, stats globales)
- `_audit-sl-positions.ts` — Vérification positions SL récentes
- `audit-redemption-sl-miss.ts` — Audit redemption SL miss
- `verify-sim-cash.ts` — Vérification cash simulation

---

## 2. Configuration SL/TP (RiskConfig)

| Paramètre | Valeur Sim | Valeur Real |
|-----------|-----------|-------------|
| `sl_tp_enabled` | `true` | `false` |
| `sl_percent` | `40%` | `50%` |
| `tp_percent` | `300%` | `500%` |
| `sl_bid_points` | `0.20` | `0.10` |
| `tp_bid_points` | `0.99` | `0.12` |
| `trailing_enabled` | `false` | `false` |
| `copy_trading_enabled` | `true` | — |
| `entry_usdc_amount` | `2 USDC` | `1.5 USDC` |
| `initial_capital` | `1000 USDC` | — |
| `max_open_positions` | `200` | `5` |
| `crypto_algo_sl_bid_points` | `0.10` | — |
| `crypto_algo_tp_bid_points` | `null` | — |
| `pre_close_enabled` | `true` (40s) | `false` |
| `time_exit_enabled` | `true` | — |

**Observation clé** : Le mode `sim` utilise `sim_sl_bid_points: 0.20` comme seuil SL absolu pour le copy trading. Le mode `real` a le SL/TP désactivé (`real_sl_tp_enabled: false`). Les positions crypto-algo sim utilisent `crypto_algo_sl_bid_points: 0.10`.

---

## 3. État Général de la Simulation

| Métrique | Valeur |
|----------|--------|
| **Cash balance** | `981.34 USDC` |
| **Capital initial** | `1000 USDC` |
| **Positions totales** | `74` |
| **Positions ouvertes** | `7` (sim) + `1` (real) |
| **Positions fermées** | `27` |
| **Positions annulées** | `38` |
| **Total PnL réalisé** | `-8.84 USDC` |
| **Equity (cash + mark value)** | `996.07 USDC` |
| **Cash flow net** | `-18.66 USDC` |
| **Écart de réconciliation** | `0.00 USDC` ✅ |

### 3.1 Répartition par close_reason

| Close Reason | Count | Total PnL |
|-------------|-------|-----------|
| `SL` | 8 | `-1.88 USDC` |
| `TP` | 3 | `+2.61 USDC` |
| `REDEMPTION` | 16 | `-13.23 USDC` |
| `MANUAL` | 1 | `-0.23 USDC` |

### 3.2 Réconciliation cash

```
Initial capital:   1000.0000
- BUY cost:          -54.6452
+ SELL credit:       +35.9893
= Expected cash:     981.3441
Actual cash:         981.3441
Gap:                  0.0001 ✅ (arrondi)
```

---

## 4. Analyse des Positions Fermées par SL

### 4.1 Position SL en mode REAL

| ID | Entry | SL% | Fill Price | Trigger PnL | Closure PnL | Realized |
|----|-------|-----|-----------|-------------|-------------|----------|
| 7068 | 0.53 | 50% | 0.33 | -36.54% | -37.74% | -0.66 |

**Verdict** : ✅ SL respecté. Le seuil à 50% correspond à un prix de `0.26`. Le fill à `0.33` est au-dessus du seuil. Trigger PnL de -36.54% < -50% → SL bien déclenché avant d'atteindre le seuil théorique (bonne exécution). Aucun tick enregistré pour cette position (0 ticks).

### 4.2 Positions SL en mode SIM (Copy Trading)

Toutes les positions SL sim utilisent `sl_bid_points: 0.20` (pas de `sl_percent`).

| ID | Entry Bid | Seuil SL (0.20) | Fill Price | Trigger PnL | Realized | Conforme ? |
|----|----------|----------------|-----------|-------------|----------|-----------|
| 17397 | 0.968 | 0.768 | 0.969 | +0.10% | -0.02 | ✅ |
| 17401 | 0.35 | 0.15 | 0.35 | 0% | -0.13 | ✅ |
| 17405 | 0.30 | 0.10 | 0.30 | 0% | -0.15 | ✅ |
| 17407 | 0.87 | 0.67 | 0.87 | 0% | -0.11 | ✅ |
| 17409 | 0.7425 | 0.5425 | 0.74 | -0.34% | -0.33 | ✅ |
| 17414 | 0.22 | 0.02 | 0.22 | 0% | -0.18 | ✅ |

**Verdict** : ✅ **Toutes les positions SL sim sont conformes.** Aucune n'a breaché le seuil `sl_bid_points: 0.20`. Le trigger PnL maximum observé est de -0.34%, très loin du seuil théorique (-20.66% à -90.91% selon le prix d'entrée).

### 4.3 ⚠️ Anomalie : SL immédiat à l'ouverture

Les positions **17401**, **17405**, **17414** ont été fermées en **0-5ms** avec un fill price identique à l'entry price :

| ID | Durée | Entry | Fill | Perte |
|----|-------|-------|------|-------|
| 17401 | 1ms | 0.36 | 0.35 | -0.13 |
| 17405 | 5ms | 0.31 | 0.30 | -0.15 |
| 17414 | 0ms | 0.23 | 0.22 | -0.18 |

**Cause probable** : Le **conservative mark** (MIN des candidats de prix) utilise un `best_bid` à `0.01` ou un `lastTradePrice` bas. Ces positions n'ont **aucun tick enregistré** (tick_count = 0), ce qui rend le diagnostic impossible sans logs.

**Perte totale** : `0.46 USDC` sur 3 positions.

---

## 5. 🔴 CRITIQUE — Positions ALGO avec SL non respecté (Missed SL)

### 5.1 Positions identifiées

| ID | Close Reason | SL Config | Min Trigger PnL | Min Bid | Seuil Prix | Realized PnL |
|----|-------------|-----------|----------------|---------|-----------|-------------|
| **17403** | REDEMPTION | 12% / 0.10 bid pts | **-100%** | **0.00** | 0.3784 / 0.33 | **-2.08 USDC** |
| **17398** | REDEMPTION | 12% / 0.10 bid pts | **-100%** | **0.00** | 0.5896 / 0.57 | **-2.04 USDC** |

**Ces 2 positions ont breaché le SL mais n'ont PAS été fermées par SL.** Elles ont été fermées par REDEMPTION (marché résolu) avec une perte totale.

### 5.2 Analyse détaillée — Position 17398 (BTC UpDown 5m)

- **Entry** : 0.68, **Entry bid** : 0.67, **SL** : 12% / 0.10 bid pts
- **Seuil SL** : prix < 0.5896 (trigger) ou < 0.57 (bid points)
- **Ticks** : 428 ticks enregistrés
- **Min trigger PnL** : -100% (prix tombé à 0.00 après end_date)
- **Peak PnL** : +29.45% (position était gagnante avant la résolution)
- **78 tentatives de vente SL** ont échoué avec erreur `no_liquidity`
- **Fermeture** : REDEMPTION à `fill_price=0` → perte de -2.04 USDC

**Chronologie** :
```
08:41:10 — Ouverture à 0.68
08:41:24 — Premier tick à 0.61 (-8.96% trigger, sous le seuil SL à 0.5896)
08:41:24 à 08:43:12 — Le prix oscille entre 0.60 et 0.75 (SL breaché puis non breaché)
08:43:00 à 08:43:12 — Le prix descend à 0.60 (-10.3% trigger, sous le seuil)
08:45:00 — End date du marché → prix tombe à 0.01 (-100%)
08:45:00 à 08:51:33 — 78 tentatives SL échouent (no_liquidity)
08:51:33 — REDEMPTION à 0 → perte totale
```

### 5.3 Analyse détaillée — Position 17403

- **Entry** : 0.44, **Entry bid** : 0.43, **SL** : 12% / 0.10 bid pts
- **Seuil SL** : prix < 0.3784 (trigger) ou < 0.33 (bid points)
- **Ticks** : 406 ticks enregistrés
- **Min trigger PnL** : -100% (prix tombé à 0.00 après end_date)
- **Peak PnL** : +89.66% (position était très gagnante)
- **Fermeture** : REDEMPTION à `fill_price=0` → perte de -2.08 USDC

### 5.4 Cause racine

Deux mécanismes distincts ont été observés :

| Mécanisme | Symptôme BDD | Patch |
|-----------|--------------|-------|
| **A — Tentatives mais échec** | `forced_exit_failed_attempts` élevé, erreur `no_liquidity` (ex. #17398 : 78 tentatives) | `patch_pipeline_sorties_no_liquidity` (retries, suppress CLOB fermé) |
| **B — Hold silencieux** | Breach SL prolongé, `forced_exit_failed_attempts = 0`, clôture `REDEMPTION` (ex. algo sim #18023) | `patch_sl_emit_blocked_no_close_bid` (fallback emit `lastCloseable` / `lastTrade` pour SL/TRAILING) |
| **C — Deadlock UpDown 5m** | Breach SL + `winningTokenId` dérivé + `acceptingOrders=false` → aucune voie CLOB (ex. #18075) | `patch_deadlock_time_exit_outcome_known` (TIME_EXIT skip sur `resolved` uniquement) |

Pour le mécanisme A, le SL a bien été **détecté et tenté**, mais l'absence totale de liquidité (`no_liquidity`) a empêché toute exécution. Le paramètre `sim_sl_close_max_retries: 5` est défini mais ne semblait pas limitant — le système a continué à réessayer bien au-delà de 5 fois (corrigé par le compteur global persisté, patch 2026-07-09).

Pour le mécanisme B, le SL était **décidé** (mark conservateur sous seuil) mais le signal n'était **jamais émis** : `resolveCloseBid` retournait 0 sans fallback autorisé pour `SL` → log `exit signal blocked — no close bid`, aucune tentative SELL.

**Perte totale évitable (mécanisme A, positions #17398/#17403)** : **4.12 USDC** (sur 2 positions).

---

## 6. Positions Ouvertes Actuelles (Sim Copy Trading)

| ID | Slug | Entry | Mark | Unrealized PnL | Peak PnL | Risque |
|----|------|-------|------|----------------|----------|--------|
| 17399 | itf-sobolie-bennema | 0.76 | 0.7475 | -0.05 | -2.35% | Faible |
| 17400 | itf-duerst-gloriap | 0.94 | 0.9158 | -0.11 | -1.24% | Faible |
| 17404 | fifwc-nor-eng-2pt5 | 0.88 | 0.86 | -0.05 | -2.62% | Faible |
| 17410 | btc-updown-5m | 0.66 | 0.999 | **+0.98** | — | ✅ Gain |
| **17411** | yes-updown | 0.43 | **0.01** | **-2.03** | — | 🔴 **Mark à 0.01** |
| 17412 | wta-yamaguc-minnen | 0.098 | 0.091 | -0.20 | -9.59% | Moyen |
| 17413 | wta-radivoj-putints | 0.74 | 0.73 | -0.04 | -0.63% | Faible |

### 6.1 ⚠️ Position 17411 — Danger silencieux

- **Entry** : 0.43, **Mark** : 0.01 (quasi nul)
- **Unrealized PnL** : -2.03 USDC
- **Seuil SL** (bid points 0.20) : 0.23
- **Mark actuel** : 0.01 << 0.23 → SL déjà breaché
- **Risque** : Si la liquidité est insuffisante, le SL pourrait ne pas s'exécuter (comme pour 17398/17403)

---

## 7. Problèmes Identifiés

### 🔴 P0 — SL non exécuté par manque de liquidité (2 positions, -4.12 USDC)

| # | Problème | Positions | Impact |
|---|----------|-----------|--------|
| 1 | Tentatives SL échouent avec `no_liquidity` | 17398, 17403 | -4.12 USDC |
| 2 | `sim_sl_close_max_retries: 5` non respecté (78 tentatives) | 17398 | Boucle infinie |
| 3 | Pas de fallback après échecs SL | 17398, 17403 | Perte totale à REDEMPTION |

**Cause** : Les marchés UpDown 5m deviennent illiquides après leur `end_date`. Le SL est détecté mais ne peut pas être exécuté. Le système réessaie indéfiniment sans mécanisme de fallback (ex: attendre la résolution avec un slippage plus large, ou utiliser le best_ask).

### 🟡 P1 — SL immédiat à l'ouverture (3 positions, -0.46 USDC)

| # | Problème | Positions | Impact |
|---|----------|-----------|--------|
| 1 | Positions fermées en <10ms avec fill = entry | 17401, 17405, 17414 | -0.46 USDC |
| 2 | Aucun tick enregistré → diagnostic impossible | 17401, 17405, 17414 | Opaque |
| 3 | Conservative mark utilise `best_bid` à 0.01 | suspecté | Faux positif SL |

**Cause probable** : Le `shouldUseConservativeExitMark` retourne `true` dès que le PnL est négatif (même -0.1%). Le conservative mark prend le MIN des candidats, dont un `best_bid` à `0.01`. Le SL se déclenche immédiatement.

### 🟡 P2 — Position 17411 en danger silencieux

| # | Problème | Impact |
|---|----------|--------|
| 1 | Mark à 0.01, seuil SL à 0.23 | SL déjà breaché |
| 2 | Pas de liquidité garantie | Risque de perte totale (-2.03 USDC) |

### 🟢 OK — Points vérifiés

| Point | Statut |
|-------|--------|
| Cash réconcilié (écart 0.0001) | ✅ |
| Positions SL copy trading conformes (6/6) | ✅ |
| Seuil `sl_bid_points: 0.20` respecté | ✅ |
| Aucune breach de seuil non détectée | ✅ |
| Configuration RiskConfig correcte | ✅ |

---

## 8. Recommandations

> **Mise à jour 2026-07-09** : les items P0/P1 ci-dessous ont été adressés par
> `docs/v1/v1-4/2026-07-09_patch_pipeline_sorties_no_liquidity.md`.
> Le hold silencieux (mécanisme B, §5.4) est adressé par
> `docs/v1/v1-4/2026-07-09_patch_sl_emit_blocked_no_close_bid.md`.
> Le deadlock UpDown 5m (mécanisme C) est adressé par
> `docs/v1/v1-4/2026-07-09_patch_deadlock_time_exit_outcome_known.md`.

### 🔴 P0 — Gestion du `no_liquidity` ✅ Implémenté

1. ~~**Limiter les tentatives SL**~~ → Compteur global `forced_exit_failed_attempts` + cooldown 5 s + garde dans strategy **et** results-consumer.
2. **Fallback slippage** : ❌ Non implémenté (hors scope v1-4).
3. ~~**Fallback REDEMPTION / CLOB fermé**~~ → `shouldSuppressSlTp()` étendu à `acceptingOrders=false` seul + réconciliation startup.
4. ~~**Monitoring**~~ → Log throttlé `forced exit retries exhausted — parking position`.
5. ~~**Émission SL bloquée** (`emitBid=0`, aucune tentative)~~ → Fallback `lastCloseableBid` / `lastTradePrice` frais pour `SL` / `TRAILING` (`patch_sl_emit_blocked_no_close_bid`).
6. ~~**Deadlock UpDown 5m** (TIME_EXIT + suppressSlTp + PRE_CLOSE)~~ → TIME_EXIT skip sur `resolved` uniquement (`patch_deadlock_time_exit_outcome_known`).

### 🟡 P1 — Conservative mark trop agressif

1. **Seuil de perte minimale** : ❌ Non modifié (intentionnel, voir patch 1 v1-4).
2. ~~**Tick recording à l'ouverture**~~ → `recordPositionOpen()` + `addPosition()` au fill BUY.
3. ~~**Logging**~~ → `warnConservativeMarkDrift` déjà en place (patch 1).

### 🟡 P2 — Monitoring des positions à risque

1. **Alerte mark < seuil SL** : ❌ Non implémenté (UI/dashboard).
2. **Alerte tentatives SL échouées** : ❌ Partiellement couvert par log `forced exit retries exhausted`.

### 📊 Améliorations générales

1. ~~**Granularité des ticks à l'ouverture**~~ → ✅ (patch 2026-07-09).
2. **Test E2E non-régression SL bid points** : ❌ Toujours ouvert.
3. **Dashboard positions à risque** : ❌ Toujours ouvert.

---

## 9. Questions Ouvertes

- [ ] Faut-il un mécanisme de "forced close" quand le SL ne peut pas s'exécuter après N tentatives (ex: vendre au marché avec slippage max) ?
- [x] Le paramètre `sim_sl_close_max_retries: 5` est-il effectif ? → **Oui depuis 2026-07-09** (compteur global persisté).
- [ ] Faut-il désactiver le SL sur les marchés UpDown 5m en fenêtre de résolution (dernières secondes) ?
- [ ] Les positions crypto-algo avec `crypto_algo_sl_bid_points: 0.10` sont-elles aussi à risque de `no_liquidity` ?
  → Oui ; le hold silencieux (mécanisme B) est corrigé côté émission ; le fill reste conditionné à la liquidité réelle en mode `real` (voir § compatibilité dans `patch_sl_emit_blocked_no_close_bid`).
- [ ] Faut-il un circuit breaker qui stoppe les nouvelles entrées si trop de SL échouent ?

---

## 10. Références

- **Brainstorm original** : `docs/v1/v1-4/2026-07-08_brainstorm_patch_sorties_copy_bid_points_conservative_mark.md`
- **Patch 1 (lastTradePrice)** : `docs/v1/v1-4/2026-07-08_patch_sorties_copy_bid_points_conservative_mark.md`
- **Patch 2 (triggerBidVwap/wsBestBid)** : `docs/v1/v1-4/2026-07-08_patch_faux_positifs_sl_executable_bid_ws_filter.md`
- **Patch 3 (no_liquidity pipeline)** : `docs/v1/v1-4/2026-07-09_patch_pipeline_sorties_no_liquidity.md`
- **Patch 4 (émission SL bloquée)** : `docs/v1/v1-4/2026-07-09_patch_sl_emit_blocked_no_close_bid.md`
- **Patch 5 (deadlock UpDown 5m)** : `docs/v1/v1-4/2026-07-09_patch_deadlock_time_exit_outcome_known.md`
