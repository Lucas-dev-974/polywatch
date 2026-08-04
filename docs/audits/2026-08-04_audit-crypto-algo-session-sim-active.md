# Audit crypto-algo — session simulation active

**Date** : 2026-08-04  
**Périmètre** : session sim crypto **#104** uniquement (`copied_positions`, mode `sim`, `opened_at >= session_started_at`). Pas d'archive, pas de mode real.  
**Extraction** : `node tools/audit-db-extract.cjs` (défaut session-scoped).

---

## 1. Résumé exécutif

Session démarrée le **04/08/2026 à 10:09 UTC** (reset sim, capital baseline **20 USDC**). Sur **~1 h** de trading (10:15 → 11:15 UTC), **28 positions** ont été remplies et clôturées.

| Indicateur | Valeur |
|---|---|
| P&L session | **−1,44 USDC** (−7,2 % du capital) |
| Solde sim | **18,56 USDC** |
| Trades clôturés | **28** (10 W / 18 L) |
| Winrate | **35,7 %** |
| Espérance | **−0,05 USDC/trade** |
| Profit factor | **0,93** |
| Drawdown intra-session | **12,66 USDC** |
| Algo | **OFF** (`crypto_algo_enabled = false`) |

**Verdict session** : profil **mixte mais légèrement perdant**. Les **18 SL** (−20,78 USDC) sont presque entièrement compensés par **9 REDEMPTION** (+18,28 USDC) et **1 TRAILING** (+1,06 USDC). Les positions tenues jusqu'à la résolution du marché gagnent ; celles stoppées rapidement perdent. Plusieurs SL se déclenchent en **1 à 11 secondes** (sélection adverse à l'entrée).

---

## 2. Contexte session

| Champ | Valeur |
|---|---|
| `session_id` | 104 |
| `boundary_at` | 2026-08-04T10:09:20.100Z |
| `baseline_capital` | 20 USDC |
| `balance_amount` | 18,56 USDC |
| Première ouverture | 2026-08-04T10:15:08.607Z |
| Dernière ouverture | 2026-08-04T11:15:45.456Z |
| Positions ouvertes restantes | **0** |
| Positions stuck | **0** |
| Annulations (non fill) | **0** |

Tous les trades de la session sont dans la bande **0,53–0,61** (config `entry_price_min/max = 0,55 / 0,60`).

---

## 3. Performance

### 3.1 Synthèse

| Métrique | Valeur |
|---|---|
| Gain moyen | +1,93 USDC |
| Perte moyenne | −1,15 USDC |
| Ratio G/L | 1,67 |
| Max win | +2,21 USDC (REDEMPTION) |
| Max loss | −1,90 USDC (SL) |
| Durée médiane | **128 s** (p10 = 5 s, p90 = 608 s) |
| Trades < 30 s | **8 / 28** (29 %) |
| Trades < 60 s | **12 / 28** (43 %) |

### 3.2 Par jambe de sortie

| Jambe | n | P&L total | P&L moyen | Winrate |
|---|---|---|---|---|
| **SL** | 18 | **−20,78** | −1,15 | 0 % |
| **REDEMPTION** | 9 | **+18,28** | +2,03 | 100 % |
| **TRAILING** | 1 | +1,06 | +1,06 | 100 % |
| **TP** | 0 | — | — | — |

Le SL reste le moteur des pertes, mais la session se redresse grâce aux positions qui survivent jusqu'à la redemption (souvent **5–10 min** de hold).

### 3.3 Par bucket d'entrée

| Bucket | n | P&L moyen | Winrate |
|---|---|---|---|
| 0,55–0,60 | 20 | −0,10 | 35 % |
| 0,60–0,65 | 6 | −0,12 | 33 % |
| 0,50–0,55 | 2 | — | — |

Toute la session est concentrée sur la bande configurée, historiquement perdante sur le long terme.

### 3.4 Courbe intra-session

Le P&L cumulé plonge rapidement jusqu'à **−13,44 USDC** (trade #12, ~10:39 UTC), puis remonte progressivement grâce aux redemptions fin de session (**−1,44 USDC** final). Les 9 dernières positions clôturées sont toutes des REDEMPTION gagnantes (+2 USDC chacune en moyenne).

---

## 4. Exécution & fiabilité sorties

### 4.1 Entrées

| Métrique | Valeur |
|---|---|
| BUY filled | **28 / 28** (100 %) |
| Slippage moyen BUY | 0,84 % (max 13,1 %) |
| Frais BUY | 2,39 USDC |

Aucun échec d'entrée sur cette session — contrairement au mode real (55 % d'échecs historiques).

### 4.2 Sorties

| Métrique | Valeur |
|---|---|
| SELL SL filled | 18 |
| SELL SL failed (FOK) | **14** |
| SELL REDEMPTION | 9 |
| SELL TRAILING | 1 |
| Frais SELL | 1,50 USDC |

**86 exit events** sur la session (vs 662 sur tout l'historique non-scoped).

| Blocage / échec | n |
|---|---|
| `forced_exit_retries_exhausted` | 42 |
| `sl_pending_confirmation` | 26 |
| FOK `order_not_matched` | 14 |
| `forced_exit_cooldown` | 4 |

**Incident notable** : position **#29690** — **59 exit events** en ~4 min (10:46–10:50 UTC), 5 SELL SL FOK ratés, clôture finale en **REDEMPTION +1,87 USDC**. Même famille que l'incident #29298 du 23/07 (boucle de sortie sur marché illiquide).

Plusieurs SL ultra-courts :

| ID | Durée | Entrée | P&L | Sortie |
|---|---|---|---|---|
| 29684 | **1 s** | 0,58 | −0,27 | SL |
| 29703 | **2 s** | 0,53 | −0,92 | SL |
| 29682 | **5 s** | 0,55 | −1,36 | SL |
| 29698 | **7 s** | 0,60 | −1,07 | SL |
| 29673 | **11 s** | 0,57 | −1,36 | SL |
| 29702 | **11 s** | 0,58 | −1,90 | SL |

---

## 5. Configuration en vigueur (post-hygiène)

| Paramètre | Valeur | Note session |
|---|---|---|
| `crypto_algo_enabled` | **false** | Entrées coupées |
| `entry_price_min / max` | 0,55 / 0,60 | 100 % des trades |
| `tp_enabled` | false | Aucun TP sur la session |
| `sl_bid_points` | 0,15 | SL moyen −1,15 USDC |
| `trailing` (config DB) | 0,05 / 0,06 | 1 seul trailing déclenché |
| `sizing_mode` | fixed_shares / **5** | Minimum exchange |
| `max_daily_loss_usdc` | **20** | Aligné sur capital sim |
| `min_spread_abs_for_adjustment` | **0,01** | Corrigé |

Les positions ouvertes en début de session portent encore `trailing_bid_points = 0,20` (valeur au moment du fill), d'où l'écart config DB vs positions live.

---

## 6. Recommandations (session)

1. **Rester OFF** tant qu'aucune preuve d'edge n'est établie sur cette bande — la session confirme le pattern SL rapide vs redemption tardive, pas un edge net.
2. **Analyser la sélection adverse** : logger le mid à +1 s / +5 s / +30 s post-entrée sur les 8 SL < 30 s.
3. **Investiguer #29690** : 59 events en 4 min — vérifier si le patch H1/H4 réduit ces boucles sur prochaine session.
4. **Avant réactivation** : backtester via `optimize-report` sur sessions sim archivées ; tester bande 0,85–0,95 ou TP activé.
5. **Sizing** : passer à 10–15 shares pour réduire le risque dust / below_min_order_size.

---

## 7. Reproductibilité

```bash
node tools/audit-db-extract.cjs
node tools/audit-db-analyze.cjs
node tools/audit-db-metrics.cjs
node tools/audit-db-exit-events2.cjs
node tools/audit-db-check-state.cjs
```

Pour inclure tout l'historique archivé : ajouter `--all-history` à chaque script.

**Canvas** : [crypto-algo-session-audit.canvas.tsx](C:\Users\lcsystem\.cursor\projects\c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1\canvases\crypto-algo-session-audit.canvas.tsx)
