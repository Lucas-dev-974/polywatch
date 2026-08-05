# Audit crypto-algo — session simulation active

**Date** : 2026-08-05 (extraction 08:42 UTC+2)  
**Périmètre** : session sim crypto **#106** uniquement (`copied_positions`, mode `sim`, `opened_at >= session_started_at`). Pas d'archive, pas de mode real.  
**Extraction** : pipeline `tools/audit-db-*.cjs` (défaut session-scoped).

---

## 1. Résumé exécutif

Session démarrée le **04/08/2026 à 20:54 UTC** (reset sim, capital baseline **20 USDC**). Trading ~1 h 10 (21:05 → 22:16 UTC). Algo **ON**. Capital quasiment épuisé.

| Indicateur | Valeur |
|---|---|
| P&L session | **−18,84 USDC** (−94,2 % du capital) |
| Solde sim | **2,03 USDC** |
| Trades clôturés | **53** (22 W / 31 L) |
| Winrate | **41,5 %** |
| Espérance | **−0,36 USDC/trade** |
| Profit factor | **0,47** |
| Drawdown intra-session | **18,26 USDC** |
| Algo | **ON** (`crypto_algo_enabled = true`) |

**Verdict** : session **fortement perdante**. Les **26 SL** (−31,27 USDC) ne sont pas compensés par **22 TRAILING** (+7,45) ni **5 REDEMPTION** (+4,98). Contrairement à la session #104 (où les redemptions sauvaient le P&L), ici le trailing se déclenche souvent mais avec de petits gains (+0,34 moy.), insuffisants face aux SL (−1,20 moy.). Une redemption a même perdu **−2,99 USDC** (`no_payout`).

**vs session #104** : −1,44 → **−18,84** ; PF 0,93 → **0,47** ; trailing 1 → **22** ; redemption 9 → **5**.

---

## 2. Contexte session

| Champ | Valeur |
|---|---|
| `session_id` | 106 |
| `boundary_at` | 2026-08-04T20:54:20.940Z |
| `baseline_capital` | 20 USDC |
| `balance_amount` | 2,02747 USDC |
| Première ouverture | 2026-08-04T21:05:12.715Z |
| Dernière ouverture | 2026-08-04T22:16:19.092Z |
| Positions ouvertes restantes | **0** |
| Positions stuck | **0** |
| Annulations (non fill) | **0** |

Bande d'entrée dominante **0,55–0,60** (38/53), reste en 0,60–0,65.

---

## 3. Performance

### 3.1 Synthèse

| Métrique | Valeur |
|---|---|
| Gain moyen | +0,75 USDC |
| Perte moyenne | −1,14 USDC |
| Ratio G/L | 0,66 |
| Max win | +2,06 USDC (REDEMPTION) |
| Max loss | −2,99 USDC (REDEMPTION no_payout) |
| Durée médiane | **63 s** (p10 = 14 s, p90 = 242 s) |
| Trades < 30 s | **11 / 53** (21 %) |
| Trades < 60 s | **25 / 53** (47 %) |

### 3.2 Par jambe de sortie

| Jambe | n | P&L total | P&L moyen | Winrate |
|---|---|---|---|---|
| **SL** | 26 | **−31,27** | −1,20 | 0 % |
| **TRAILING** | 22 | **+7,45** | +0,34 | 81,8 % |
| **REDEMPTION** | 5 | **+4,98** | +1,00 | 80 % |
| **TP** | 0 | — | — | — |

Le trailing gagne souvent mais trop peu ; le SL détruit le capital. Une redemption perdante (#29799, −2,99) est un événement rare et coûteux.

### 3.3 Par bucket d'entrée

| Bucket | n | P&L total | P&L moyen | Winrate |
|---|---|---|---|---|
| 0,55–0,60 | 38 | −14,18 | −0,37 | 42 % |
| 0,60–0,65 | 11 | −4,45 | −0,40 | 36 % |

### 3.4 Courbe intra-session

P&L cumulé en baisse quasi continue : creux vers **−18,84 USDC** en fin de session. Les 5 derniers trades sont tous des SL (−1,12 à −1,36). Pas de remontée redemption comme en #104.

---

## 4. Exécution & fiabilité sorties

### 4.1 Entrées

| Métrique | Valeur |
|---|---|
| BUY filled | **53 / 53** (100 %) |
| Slippage moyen BUY | 0,79 % (max 8,9 %) |
| Frais BUY | 4,51 USDC |

### 4.2 Sorties

| Métrique | Valeur |
|---|---|
| SELL SL filled | 26 |
| SELL SL failed (FOK) | **18** |
| SELL TRAILING filled | 22 |
| SELL TRAILING failed | **16** |
| SELL REDEMPTION filled | 4 |
| SELL REDEMPTION no_payout | **1** |
| Frais SELL | ~3,67 USDC |

**254 exit events** sur la session.

| Blocage / échec | n |
|---|---|
| `forced_exit_retries_exhausted` | 154 |
| `sl_pending_confirmation` | 58 |
| FOK `order_not_matched` (SL) | 18 |
| FOK `order_not_matched` (TRAILING) | 16 |
| `forced_exit_cooldown` | 8 |

**Incidents notables** :

| Position | Exit events | Issue |
|---|---|---|
| **#29799** | **101** (~8 min) | Boucle SL puis REDEMPTION **−2,99** (`no_payout`) |
| **#29755** | 65 | Boucle puis REDEMPTION +2,06 |
| **#29803** | 41 | Boucle puis REDEMPTION +1,97 |

SL ultra-courts :

| ID | Durée | Entrée | P&L |
|---|---|---|---|
| 29779 | **2 s** | 0,59 | −0,32 |
| 29767 | **4 s** | 0,54 | −1,07 |
| 29780 | **5 s** | 0,59 | −1,44 |
| 29766 | **14 s** | 0,57 | −1,46 |
| 29806 | **14 s** | 0,60 | −1,12 |
| 29791 | **15 s** | 0,60 | −1,02 |

---

## 5. Configuration en vigueur

| Paramètre | Valeur | Note session |
|---|---|---|
| `crypto_algo_enabled` | **true** | Entrées actives |
| `entry_price_min / max` | 0,55 / 0,60 | Majorité des trades |
| `tp_enabled` | false | Aucun TP |
| `sl_bid_points` | 0,15 | SL moyen −1,20 |
| `trailing` | on · 0,05 / 0,06 | **22** trailings (+7,45) |
| `sizing` | fixed_shares / 5 | |
| `sim_initial_capital_crypto` | 20 | Solde restant 2,03 |

---

## 6. Scripts d'audit DB utilisés

| Script | Rôle |
|---|---|
| `audit-db-check-state.cjs` | Session active + positions open + algo enabled |
| `audit-db-extract.cjs` | Dump JSON scoped session |
| `audit-db-analyze.cjs` | Tables positions / execs |
| `audit-db-metrics.cjs` | KPIs WR, PF, DD, buckets |
| `audit-db-exit-events2.cjs` | Breakdown exit events |

```bash
node tools/audit-db-check-state.cjs
node tools/audit-db-extract.cjs
node tools/audit-db-analyze.cjs
node tools/audit-db-metrics.cjs
node tools/audit-db-exit-events2.cjs
```

---

## 7. Recommandations

1. **Couper l'algo** — capital quasi épuisé (−94 %) ; edge négatif clair (PF 0,47).
2. **Trailing** : wins fréquents mais trop petits vs SL — revoir activation / distance, ou exiger un R:R minimum.
3. **#29799** : 101 events + redemption `no_payout` −2,99 — prioriser le patch des boucles de sortie et le cas payout=0.
4. **Bande 0,55–0,60** : confirme la session #104, toujours perdante.
5. Avant réactivation : reset sim + backtest ; ne pas relancer sur ce solde (2 USDC).

---

## 8. Canvas

[crypto-algo-session-audit.canvas.tsx](C:\Users\lcsystem\.cursor\projects\c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1\canvases\crypto-algo-session-audit.canvas.tsx)
